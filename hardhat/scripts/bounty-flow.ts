/**
 * Automates commit → reveal → judge → finalize for a bounty you created in the UI.
 *
 * Usage:
 *   pnpm bounty:commit -- --bounty-id 1
 *   pnpm bounty:reveal -- --bounty-id 1
 *   pnpm bounty:judge  -- --bounty-id 1
 *   pnpm bounty:auto   -- --bounty-id 1
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  encodePacked,
  http,
  keccak256,
  parseAbi,
  parseEther,
  type Hex,
  type Address,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (m) {
      const v = m[2].trim();
      if (v) process.env[m[1].trim()] = v;
    }
  }
}

loadEnvFile(resolve(ROOT, ".env"));

const RPC = process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org";
const CHAIN_ID = 1979;
const CONTRACT = process.env.CONTRACT_ADDRESS as Address;
const EXECUTOR = (process.env.RITUAL_EXECUTOR_ADDRESS ??
  "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B") as Address;
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948" as Address;

const ritualChain = {
  id: CHAIN_ID,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const aiJudgeAbi = parseAbi([
  "function nextBountyId() view returns (uint256)",
  "function getBounty(uint256 bountyId) view returns (address owner, string title, string rubric, uint256 reward, uint256 submissionDeadline, uint256 revealDeadline, bool judged, bool finalized, uint256 submissionCount, uint256 revealedCount, uint256 winnerIndex, bytes aiReview)",
  "function getSubmission(uint256 bountyId, uint256 index) view returns (address submitter, bytes32 commitment, bool revealed, string answer)",
  "function hasCommitted(uint256 bountyId, address account) view returns (bool)",
  "function submitCommitment(uint256 bountyId, bytes32 commitment)",
  "function revealAnswer(uint256 bountyId, string answer, bytes32 salt)",
  "function judgeAll(uint256 bountyId, bytes llmInput)",
  "function finalizeWinner(uint256 bountyId, uint256 winnerIndex)",
]);

const ritualWalletAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function lockUntil(address account) view returns (uint256)",
  "function deposit(uint256 lockDuration) payable",
]);

function normalizeKey(raw: string): Hex {
  const t = raw.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

function getAccounts() {
  const creatorKey = process.env.CREATOR_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY;
  const user1Key = process.env.USER1_PRIVATE_KEY;
  const user2Key = process.env.USER2_PRIVATE_KEY;

  if (!CONTRACT) throw new Error("CONTRACT_ADDRESS missing in hardhat/.env");
  if (!creatorKey) throw new Error("CREATOR_PRIVATE_KEY missing in hardhat/.env");
  if (!user1Key) throw new Error("USER1_PRIVATE_KEY missing in hardhat/.env");
  if (!user2Key) throw new Error("USER2_PRIVATE_KEY missing in hardhat/.env");

  return {
    creator: privateKeyToAccount(normalizeKey(creatorKey)),
    user1: privateKeyToAccount(normalizeKey(user1Key)),
    user2: privateKeyToAccount(normalizeKey(user2Key)),
  };
}

function saltsPath(bountyId: bigint) {
  return resolve(ROOT, `.bounty-salts-${bountyId}.json`);
}

type SaltStore = {
  user1: { answer: string; salt: Hex };
  user2: { answer: string; salt: Hex };
};

function randomSalt(): Hex {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}` as Hex;
}

function commitment(bountyId: bigint, answer: string, salt: Hex, submitter: Address): Hex {
  return keccak256(
    encodePacked(["string", "bytes32", "address", "uint256"], [answer, salt, submitter, bountyId]),
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? "auto";
  let bountyId: bigint | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--bounty-id" && args[i + 1]) bountyId = BigInt(args[i + 1]);
  }
  return { cmd, bountyId };
}

const JUDGE_ALL_GAS = 3_000_000n;
const MIN_LLM_BALANCE = parseEther("0.05");
const DEPOSIT_AMOUNT = parseEther("0.05");
const LOCK_DURATION = 100_000n;
const REQUIRED_TTL_BUFFER = 300n;

function buildLlmInput(title: string, rubric: string, submissions: { index: number; submitter: Address; answer: string }[]) {
  const llmParams = parseAbiParameters(
    "address, bytes[], uint256, bytes[], bytes, string, string, int256, string, bool, int256, string, string, uint256, bool, int256, string, bytes, int256, string, string, bool, int256, bytes, bytes, int256, int256, string, bool, (string,string,string)",
  );
  const messages = JSON.stringify([
    { role: "system", content: "You are an impartial bounty judge. Return JSON: {\"winnerIndex\": number, \"summary\": \"...\"}" },
    { role: "user", content: `Title: ${title}\nRubric: ${rubric}\nSubmissions:\n${JSON.stringify(submissions, null, 2)}` },
  ]);
  return encodeAbiParameters(llmParams, [
    EXECUTOR, [], 300n, [], "0x", messages, "zai-org/GLM-4.7-FP8",
    0n, "", false, 4096n, "", "", 1n, true, 0n, "medium", "0x", -1n, "auto", "", false, 700n,
    "0x", "0x", -1n, 1000n, "", false, ["", "", ""],
  ]);
}

async function waitUntil(label: string, targetMs: bigint) {
  const publicClient = createPublicClient({ chain: ritualChain, transport: http(RPC) });
  while (true) {
    const now = BigInt(Date.now());
    const leftMs = Number(targetMs - now);
    if (now >= targetMs) {
      console.log(`✓ ${label} — deadline passed`);
      return;
    }
    console.log(`… waiting for ${label} (~${Math.ceil(leftMs / 1000)}s left)`);
    await sleep(Math.min(Math.max(leftMs, 0), 30_000));
    void publicClient;
  }
}

async function runCommits(bountyId: bigint) {
  const { user1, user2 } = getAccounts();
  const publicClient = createPublicClient({ chain: ritualChain, transport: http(RPC) });

  const path = saltsPath(bountyId);
  let store: SaltStore;
  if (existsSync(path)) {
    store = JSON.parse(readFileSync(path, "utf8")) as SaltStore;
  } else {
    store = {
      user1: { answer: process.env.USER1_ANSWER ?? "User1: Use commit-reveal to hide answers until reveal phase.", salt: randomSalt() },
      user2: { answer: process.env.USER2_ANSWER ?? "User2: Ritual LLM batch-judges all revealed submissions together.", salt: randomSalt() },
    };
    writeFileSync(path, JSON.stringify(store, null, 2));
  }

  for (const [label, account, data] of [
    ["user1", user1, store.user1],
    ["user2", user2, store.user2],
  ] as const) {
    const committed = await publicClient.readContract({
      address: CONTRACT,
      abi: aiJudgeAbi,
      functionName: "hasCommitted",
      args: [bountyId, account.address],
    });
    if (committed) {
      console.log(`• ${label} already committed — skip`);
      continue;
    }
    const hash = commitment(bountyId, data.answer, data.salt, account.address);
    const wallet = createWalletClient({ account, chain: ritualChain, transport: http(RPC) });
    const tx = await wallet.writeContract({
      address: CONTRACT,
      abi: aiJudgeAbi,
      functionName: "submitCommitment",
      args: [bountyId, hash],
    });
    console.log(`✓ ${label} committed — tx ${tx}`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }
}

async function runReveals(bountyId: bigint) {
  const { user1, user2 } = getAccounts();
  const publicClient = createPublicClient({ chain: ritualChain, transport: http(RPC) });
  const path = saltsPath(bountyId);
  if (!existsSync(path)) throw new Error(`Salt file missing: ${path}. Run bounty:commit first.`);
  const store = JSON.parse(readFileSync(path, "utf8")) as SaltStore;

  for (const [label, account, data] of [
    ["user1", user1, store.user1],
    ["user2", user2, store.user2],
  ] as const) {
    const wallet = createWalletClient({ account, chain: ritualChain, transport: http(RPC) });
    const tx = await wallet.writeContract({
      address: CONTRACT,
      abi: aiJudgeAbi,
      functionName: "revealAnswer",
      args: [bountyId, data.answer, data.salt],
    });
    console.log(`✓ ${label} revealed — tx ${tx}`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  }
}

async function runJudge(bountyId: bigint) {
  const { creator } = getAccounts();
  const publicClient = createPublicClient({ chain: ritualChain, transport: http(RPC) });
  const wallet = createWalletClient({ account: creator, chain: ritualChain, transport: http(RPC) });

  const bounty = await publicClient.readContract({
    address: CONTRACT,
    abi: aiJudgeAbi,
    functionName: "getBounty",
    args: [bountyId],
  });

  const [balance, lockUntil, blockNum] = await Promise.all([
    publicClient.readContract({ address: RITUAL_WALLET, abi: ritualWalletAbi, functionName: "balanceOf", args: [creator.address] }),
    publicClient.readContract({ address: RITUAL_WALLET, abi: ritualWalletAbi, functionName: "lockUntil", args: [creator.address] }),
    publicClient.getBlockNumber(),
  ]);

  if (balance < MIN_LLM_BALANCE || lockUntil < blockNum + REQUIRED_TTL_BUFFER) {
    console.log("• Funding RitualWallet (0.05 RITUAL)…");
    const dep = await wallet.writeContract({
      address: RITUAL_WALLET,
      abi: ritualWalletAbi,
      functionName: "deposit",
      args: [LOCK_DURATION],
      value: DEPOSIT_AMOUNT,
    });
    await publicClient.waitForTransactionReceipt({ hash: dep });
    console.log("✓ RitualWallet funded");
  }

  const submissions: { index: number; submitter: Address; answer: string }[] = [];
  const count = Number(bounty[8]);
  for (let i = 0; i < count; i++) {
    const [submitter, , revealed, answer] = await publicClient.readContract({
      address: CONTRACT,
      abi: aiJudgeAbi,
      functionName: "getSubmission",
      args: [bountyId, BigInt(i)],
    });
    if (revealed && answer) submissions.push({ index: i, submitter, answer });
  }
  if (submissions.length === 0) throw new Error("No revealed submissions to judge");

  const llmInput = buildLlmInput(bounty[1], bounty[2], submissions);
  const data = encodeFunctionData({
    abi: aiJudgeAbi,
    functionName: "judgeAll",
    args: [bountyId, llmInput],
  });
  // Ritual async LLM txs revert during eth_estimateGas — send raw tx with explicit gas.
  const request = await wallet.prepareTransactionRequest({
    to: CONTRACT,
    data,
    gas: 5_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    maxFeePerGas: 50_000_000_000n,
  });
  const serialized = await wallet.signTransaction(request);
  const rpcRes = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendRawTransaction",
      params: [serialized],
    }),
  });
  const rpcJson = (await rpcRes.json()) as { result?: string; error?: { message: string } };
  if (rpcJson.error) throw new Error(rpcJson.error.message);
  const tx = rpcJson.result as Hex;
  console.log(`✓ judgeAll sent — tx ${tx}`);
  console.log(`Explorer: https://explorer.ritualfoundation.org/tx/${tx}`);
  await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 600_000 });
}

async function runFinalize(bountyId: bigint, winnerIndex = 0) {
  const { creator } = getAccounts();
  const publicClient = createPublicClient({ chain: ritualChain, transport: http(RPC) });
  const wallet = createWalletClient({ account: creator, chain: ritualChain, transport: http(RPC) });

  const tx = await wallet.writeContract({
    address: CONTRACT,
    abi: aiJudgeAbi,
    functionName: "finalizeWinner",
    args: [bountyId, BigInt(winnerIndex)],
  });
  console.log(`✓ finalizeWinner(${winnerIndex}) — tx ${tx}`);
  await publicClient.waitForTransactionReceipt({ hash: tx });
}

async function resolveBountyId(given?: bigint): Promise<bigint> {
  if (given !== undefined) return given;
  const publicClient = createPublicClient({ chain: ritualChain, transport: http(RPC) });
  const next = await publicClient.readContract({ address: CONTRACT, abi: aiJudgeAbi, functionName: "nextBountyId" });
  if (next <= 1n) throw new Error("No bounty found. Create one in the UI first.");
  const id = next - 1n;
  console.log(`• Using latest bounty id: ${id}`);
  return id;
}

async function main() {
  const { cmd, bountyId: argId } = parseArgs();
  const bountyId = await resolveBountyId(argId);
  const publicClient = createPublicClient({ chain: ritualChain, transport: http(RPC) });
  const bounty = await publicClient.readContract({ address: CONTRACT, abi: aiJudgeAbi, functionName: "getBounty", args: [bountyId] });

  console.log(`\n=== Bounty #${bountyId}: ${bounty[1]} ===`);
  console.log(`Submission deadline: ${bounty[4]} | Reveal deadline: ${bounty[5]}\n`);

  if (cmd === "commit" || cmd === "bounty:commit") {
    await runCommits(bountyId);
    return;
  }
  if (cmd === "reveal" || cmd === "bounty:reveal") {
    await waitUntil("submission deadline", bounty[4]);
    await runReveals(bountyId);
    return;
  }
  if (cmd === "judge" || cmd === "bounty:judge") {
    await waitUntil("reveal deadline", bounty[5]);
    await runJudge(bountyId);
    await runFinalize(bountyId, 0);
    return;
  }

  // auto
  await runCommits(bountyId);
  await waitUntil("submission deadline", bounty[4]);
  await runReveals(bountyId);
  await waitUntil("reveal deadline", bounty[5]);
  await runJudge(bountyId);
  await runFinalize(bountyId, 0);
  console.log("\n✅ Full bounty flow complete!");
}

main().catch((e) => {
  console.error("\n❌", e.shortMessage ?? e.message ?? e);
  process.exit(1);
});