import {
  createPublicClient,
  createWalletClient,
  encodePacked,
  http,
  keccak256,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { buildJudgeAllLlmInput, JUDGE_ALL_GAS } from "../ritualLlm";
import { DEPOSIT_AMOUNT, LOCK_DURATION, MIN_LLM_BALANCE, REQUIRED_TTL_BUFFER } from "../ritualWallet";
import { loadHardhatEnv, loadSalts, saveSalts, type SaltStore } from "./loadEnv";

const RPC = process.env.NEXT_PUBLIC_RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_RITUAL_CHAIN_ID ?? "1979");
const EXECUTOR = (process.env.NEXT_PUBLIC_RITUAL_EXECUTOR_ADDRESS ??
  "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B") as Address;
const RITUAL_WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948" as Address;

const ritualChain = {
  id: CHAIN_ID,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
} as const;

const aiJudgeAbi = parseAbi([
  "function getBounty(uint256 bountyId) view returns (address owner, string title, string rubric, uint256 reward, uint256 submissionDeadline, uint256 revealDeadline, bool judged, bool finalized, uint256 submissionCount, uint256 revealedCount, uint256 winnerIndex, bytes aiReview)",
  "function getSubmission(uint256 bountyId, uint256 index) view returns (address submitter, bytes32 commitment, bool revealed, string answer)",
  "function hasCommitted(uint256 bountyId, address account) view returns (bool)",
  "function createBounty(string title, string rubric, uint256 submissionDeadline, uint256 revealDeadline) payable returns (uint256)",
  "function submitCommitment(uint256 bountyId, bytes32 commitment)",
  "function revealAnswer(uint256 bountyId, string answer, bytes32 salt)",
  "function judgeAll(uint256 bountyId, bytes llmInput)",
  "function finalizeWinner(uint256 bountyId, uint256 winnerIndex)",
  "event BountyCreated(uint256 indexed bountyId, address indexed owner, string title, uint256 reward, uint256 submissionDeadline, uint256 revealDeadline)",
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
  const env = { ...loadHardhatEnv(), ...process.env };
  const contract = (env.CONTRACT_ADDRESS ?? env.NEXT_PUBLIC_CONTRACT_ADDRESS) as Address;
  const creatorKey = env.CREATOR_PRIVATE_KEY ?? env.DEPLOYER_PRIVATE_KEY;
  const user1Key = env.USER1_PRIVATE_KEY;
  const user2Key = env.USER2_PRIVATE_KEY;

  if (!contract) throw new Error("CONTRACT_ADDRESS missing in hardhat/.env");
  if (!creatorKey) throw new Error("CREATOR_PRIVATE_KEY missing in hardhat/.env");
  if (!user1Key) throw new Error("USER1_PRIVATE_KEY missing in hardhat/.env");
  if (!user2Key) throw new Error("USER2_PRIVATE_KEY missing in hardhat/.env");

  return {
    contract,
    creator: privateKeyToAccount(normalizeKey(creatorKey)),
    user1: privateKeyToAccount(normalizeKey(user1Key)),
    user2: privateKeyToAccount(normalizeKey(user2Key)),
    env,
  };
}

function publicClient() {
  return createPublicClient({ chain: ritualChain, transport: http(RPC) });
}

function walletClient(account: ReturnType<typeof privateKeyToAccount>) {
  return createWalletClient({ account, chain: ritualChain, transport: http(RPC) });
}

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

export type CreateBountyInput = {
  title: string;
  rubric: string;
  reward: string;
  submissionDeadline: number;
  revealDeadline: number;
};

export async function createBountyAndCommit(input: CreateBountyInput) {
  const { contract, creator, user1, user2, env } = getAccounts();
  const client = publicClient();
  const creatorWallet = walletClient(creator);

  const block = await client.getBlock();
  const chainNow = block.timestamp;
  const submissionMs = BigInt(input.submissionDeadline);
  const revealMs = BigInt(input.revealDeadline);
  const minBuffer = 60_000n;

  if (submissionMs <= chainNow + minBuffer) {
    throw new Error(
      `Submission deadline must be at least 1 minute in the future on Ritual chain. ` +
        `Chain time uses milliseconds — pick later deadlines in the form.`,
    );
  }
  if (revealMs <= submissionMs) {
    throw new Error("Reveal deadline must be after submission deadline.");
  }

  const rewardWei = parseEther(input.reward);
  const hash = await creatorWallet.writeContract({
    address: contract,
    abi: aiJudgeAbi,
    functionName: "createBounty",
    args: [input.title, input.rubric, submissionMs, revealMs],
    value: rewardWei,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });

  const createdLog = receipt.logs.find((l) => l.topics.length >= 2);
  if (!createdLog?.topics[1]) {
    throw new Error("Could not read bountyId from create transaction");
  }
  const bountyId = BigInt(createdLog.topics[1]);

  const store: SaltStore = {
    user1: {
      answer:
        env.USER1_ANSWER ??
        "User1: Commit-reveal hides answers during the submission phase.",
      salt: randomSalt(),
    },
    user2: {
      answer:
        env.USER2_ANSWER ??
        "User2: Ritual LLM batch-judges all revealed submissions in one transaction.",
      salt: randomSalt(),
    },
  };
  saveSalts(bountyId, store);

  const txs: string[] = [hash];
  for (const [account, data] of [
    [user1, store.user1],
    [user2, store.user2],
  ] as const) {
    const w = walletClient(account);
    const c = commitment(bountyId, data.answer, data.salt, account.address);
    const tx = await w.writeContract({
      address: contract,
      abi: aiJudgeAbi,
      functionName: "submitCommitment",
      args: [bountyId, c],
    });
    await client.waitForTransactionReceipt({ hash: tx });
    txs.push(tx);
  }

  return {
    bountyId: bountyId.toString(),
    createTx: hash,
    commitTxs: txs.slice(1),
    phase: "commit",
    message: "Bounty created. User1 & User2 committed. Waiting for submission deadline…",
  };
}

export async function advanceBounty(bountyId: bigint) {
  const { contract, creator, user1, user2 } = getAccounts();
  const client = publicClient();
  const now = BigInt(Date.now());

  const bounty = await client.readContract({
    address: contract,
    abi: aiJudgeAbi,
    functionName: "getBounty",
    args: [bountyId],
  });

  const [
    ,
    title,
    rubric,
    ,
    submissionDeadline,
    revealDeadline,
    judged,
    finalized,
    submissionCount,
    revealedCount,
  ] = bounty;

  if (finalized) {
    return { phase: "finalized", message: "Bounty complete.", bountyId: bountyId.toString() };
  }

  if (judged) {
    const w = walletClient(creator);
    const tx = await w.writeContract({
      address: contract,
      abi: aiJudgeAbi,
      functionName: "finalizeWinner",
      args: [bountyId, 0n],
    });
    await client.waitForTransactionReceipt({ hash: tx });
    return { phase: "finalized", message: "Winner finalized.", tx, bountyId: bountyId.toString() };
  }

  if (now >= revealDeadline) {
    const w = walletClient(creator);
    const [balance, lockUntil, blockNum] = await Promise.all([
      client.readContract({ address: RITUAL_WALLET, abi: ritualWalletAbi, functionName: "balanceOf", args: [creator.address] }),
      client.readContract({ address: RITUAL_WALLET, abi: ritualWalletAbi, functionName: "lockUntil", args: [creator.address] }),
      client.getBlockNumber(),
    ]);
    if (balance < MIN_LLM_BALANCE || lockUntil < blockNum + REQUIRED_TTL_BUFFER) {
      const dep = await w.writeContract({
        address: RITUAL_WALLET,
        abi: ritualWalletAbi,
        functionName: "deposit",
        args: [LOCK_DURATION],
        value: DEPOSIT_AMOUNT,
      });
      await client.waitForTransactionReceipt({ hash: dep });
    }

    const submissions: { index: number; submitter: Address; answer: string }[] = [];
    for (let i = 0; i < Number(submissionCount); i++) {
      const [submitter, , revealed, answer] = await client.readContract({
        address: contract,
        abi: aiJudgeAbi,
        functionName: "getSubmission",
        args: [bountyId, BigInt(i)],
      });
      if (revealed && answer) submissions.push({ index: i, submitter, answer });
    }
    if (submissions.length === 0) {
      return { phase: "error", message: "No revealed submissions to judge.", bountyId: bountyId.toString() };
    }

    const llmInput = buildJudgeAllLlmInput({
      executorAddress: EXECUTOR,
      title,
      rubric,
      submissions,
    });
    const tx = await w.writeContract({
      address: contract,
      abi: aiJudgeAbi,
      functionName: "judgeAll",
      args: [bountyId, llmInput],
      // LLM precompiles return empty output during eth_estimateGas — must set gas explicitly.
      gas: JUDGE_ALL_GAS,
    });
    await client.waitForTransactionReceipt({ hash: tx, timeout: 600_000 });
    return { phase: "judged", message: "AI judging complete. Finalizing…", tx, bountyId: bountyId.toString() };
  }

  if (now >= submissionDeadline) {
    const salts = loadSalts(bountyId);
    if (!salts) {
      return { phase: "error", message: "Salt file missing.", bountyId: bountyId.toString() };
    }
    const txs: string[] = [];
    for (const [account, data] of [
      [user1, salts.user1],
      [user2, salts.user2],
    ] as const) {
      const already = await client.readContract({
        address: contract,
        abi: aiJudgeAbi,
        functionName: "hasCommitted",
        args: [bountyId, account.address],
      });
      if (!already) continue;

      let submissionIndex = -1;
      for (let i = 0; i < Number(submissionCount); i++) {
        const [submitter, , revealed] = await client.readContract({
          address: contract,
          abi: aiJudgeAbi,
          functionName: "getSubmission",
          args: [bountyId, BigInt(i)],
        });
        if (submitter.toLowerCase() === account.address.toLowerCase()) {
          if (revealed) submissionIndex = -2;
          else submissionIndex = i;
          break;
        }
      }
      if (submissionIndex < 0) continue;
      const w = walletClient(account);
      const tx = await w.writeContract({
        address: contract,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, data.answer, data.salt],
      });
      await client.waitForTransactionReceipt({ hash: tx });
      txs.push(tx);
    }
    return {
      phase: "revealed",
      message: "Answers revealed. Waiting for reveal deadline…",
      txs,
      bountyId: bountyId.toString(),
      revealedCount: revealedCount.toString(),
    };
  }

  const waitSec = Math.max(0, Math.ceil(Number(submissionDeadline - now) / 1000));
  return {
    phase: "commit",
    message: `Waiting for submission deadline (~${waitSec}s)…`,
    bountyId: bountyId.toString(),
  };
}