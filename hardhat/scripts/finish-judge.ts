import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  http,
  parseAbi,
  parseAbiParameters,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (existsSync(resolve(ROOT, ".env"))) {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (m?.[2].trim()) process.env[m[1].trim()] = m[2].trim();
  }
}

const RPC = process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org";
const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const key = (process.env.CREATOR_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY)!;
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const contract = process.env.CONTRACT_ADDRESS as Address;
const executor = (process.env.RITUAL_EXECUTOR_ADDRESS ?? "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B") as Address;
const bountyId = BigInt(process.argv[2] ?? "1");

const pub = createPublicClient({ chain, transport: http(RPC) });
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948" as Address;
const LOCK_DURATION = 100_000n;
const REQUIRED_TTL_BUFFER = 300n;

const abi = parseAbi([
  "function getBounty(uint256) view returns (address,string,string,uint256,uint256,uint256,bool,bool,uint256,uint256,uint256,bytes)",
  "function getSubmission(uint256,uint256) view returns (address,bytes32,bool,string)",
  "function judgeAll(uint256,bytes)",
  "function finalizeWinner(uint256,uint256)",
]);

const ritualWalletAbi = parseAbi([
  "function deposit(uint256 lockDuration) payable",
  "function balanceOf(address) view returns (uint256)",
  "function lockUntil(address) view returns (uint256)",
]);

const llmParams = parseAbiParameters(
  "address,bytes[],uint256,bytes[],bytes,string,string,int256,string,bool,int256,string,string,uint256,bool,int256,string,bytes,int256,string,string,bool,int256,bytes,bytes,int256,int256,string,bool,(string,string,string)",
);

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function readBounty() {
  return pub.readContract({ address: contract, abi, functionName: "getBounty", args: [bountyId] });
}

async function finalize() {
  const tx = await wallet.writeContract({
    address: contract,
    abi,
    functionName: "finalizeWinner",
    args: [bountyId, 0n],
  });
  const r = await pub.waitForTransactionReceipt({ hash: tx, timeout: 120_000 });
  console.log("✓ finalizeWinner", tx, "status", r.status);
}

async function ensureRitualWallet() {
  const [blockNum, lockUntil] = await Promise.all([
    pub.getBlockNumber(),
    pub.readContract({
      address: RITUAL_WALLET,
      abi: ritualWalletAbi,
      functionName: "lockUntil",
      args: [account.address],
    }),
  ]);
  if (lockUntil >= blockNum + REQUIRED_TTL_BUFFER) return;
  console.log("• RitualWallet lock expired — depositing 0.1 RITUAL…");
  const dep = await wallet.writeContract({
    address: RITUAL_WALLET,
    abi: ritualWalletAbi,
    functionName: "deposit",
    args: [LOCK_DURATION],
    value: parseEther("0.1"),
    gas: 500_000n,
  });
  await pub.waitForTransactionReceipt({ hash: dep, timeout: 120_000 });
  const lock2 = await pub.readContract({
    address: RITUAL_WALLET,
    abi: ritualWalletAbi,
    functionName: "lockUntil",
    args: [account.address],
  });
  console.log("✓ RitualWallet refreshed, lockUntil:", lock2.toString());
}

async function sendJudge() {
  await ensureRitualWallet();
  const bounty = await readBounty();
  const subs: { index: number; submitter: Address; answer: string }[] = [];
  for (let i = 0; i < Number(bounty[8]); i++) {
    const s = await pub.readContract({ address: contract, abi, functionName: "getSubmission", args: [bountyId, BigInt(i)] });
    if (s[2]) subs.push({ index: i, submitter: s[0], answer: s[3] });
  }
  if (subs.length === 0) throw new Error("No revealed submissions");

  const messages = JSON.stringify([
    { role: "system", content: 'Return JSON: {"winnerIndex":0,"summary":"User1 wins"}' },
    { role: "user", content: `Title:${bounty[1]} Rubric:${bounty[2]} Subs:${JSON.stringify(subs)}` },
  ]);
  const llmInput = encodeAbiParameters(llmParams, [
    executor, [], 300n, [], "0x", messages, "zai-org/GLM-4.7-FP8",
    0n, "", false, 4096n, "", "", 1n, true, 0n, "medium", "0x", -1n, "auto", "", false, 700n,
    "0x", "0x", -1n, 1000n, "", false, ["", "", ""],
  ]);

  const data = encodeFunctionData({ abi, functionName: "judgeAll", args: [bountyId, llmInput] });
  const request = await wallet.prepareTransactionRequest({
    to: contract,
    data,
    gas: 5_000_000n,
    maxPriorityFeePerGas: 3_000_000_000n,
    maxFeePerGas: 60_000_000_000n,
  });
  const serialized = await wallet.signTransaction(request);
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [serialized] }),
  });
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  const hash = json.result as Hex;
  console.log("✓ judgeAll submitted", hash);
  console.log("Explorer:", `https://explorer.ritualfoundation.org/tx/${hash}`);
  return hash;
}

async function main() {
  let bounty = await readBounty();
  console.log(`Bounty #${bountyId}: judged=${bounty[6]} finalized=${bounty[7]} revealed=${bounty[9]}`);

  if (bounty[7]) {
    console.log("Already finalized.");
    return;
  }

  if (!bounty[6]) {
    await sendJudge();
    for (let i = 0; i < 60; i++) {
      await sleep(10_000);
      bounty = await readBounty();
      if (bounty[6]) {
        console.log("✓ judged on-chain, aiReview bytes:", bounty[11].length);
        break;
      }
      if (i % 6 === 5) console.log(`… poll ${i + 1}/60 judged=false`);
    }
    if (!bounty[6]) throw new Error("Judge not confirmed after 10 min — check Ritual async explorer");
  }

  await finalize();
  bounty = await readBounty();
  console.log("✅ Done — judged:", bounty[6], "finalized:", bounty[7]);
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});