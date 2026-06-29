import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  formatEther,
  http,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "..");
if (existsSync(resolve(ROOT, ".env"))) {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (m?.[2].trim()) process.env[m[1].trim()] = m[2].trim();
  }
}

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org"] } },
} as const;

const key = (process.env.CREATOR_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY)!;
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
const contract = process.env.CONTRACT_ADDRESS as Address;
const executor = (process.env.RITUAL_EXECUTOR_ADDRESS ?? "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B") as Address;

const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });
const abi = parseAbi([
  "function getBounty(uint256) view returns (address,string,string,uint256,uint256,uint256,bool,bool,uint256,uint256,uint256,bytes)",
  "function getSubmission(uint256,uint256) view returns (address,bytes32,bool,string)",
  "function judgeAll(uint256,bytes)",
  "function finalizeWinner(uint256,uint256)",
]);

const llmParams = parseAbiParameters(
  "address,bytes[],uint256,bytes[],bytes,string,string,int256,string,bool,int256,string,string,uint256,bool,int256,string,bytes,int256,string,string,bool,int256,bytes,bytes,int256,int256,string,bool,(string,string,string)",
);

async function main() {
  const bountyId = BigInt(process.argv[2] ?? "1");
  const bounty = await pub.readContract({ address: contract, abi, functionName: "getBounty", args: [bountyId] });
  if (bounty[6]) {
    console.log("Already judged — finalizing…");
    const tx = await wallet.writeContract({ address: contract, abi, functionName: "finalizeWinner", args: [bountyId, 0n] });
    const r = await pub.waitForTransactionReceipt({ hash: tx });
    console.log("Finalized:", r.status);
    return;
  }

  const subs: { index: number; submitter: Address; answer: string }[] = [];
  for (let i = 0; i < Number(bounty[8]); i++) {
    const s = await pub.readContract({ address: contract, abi, functionName: "getSubmission", args: [bountyId, BigInt(i)] });
    if (s[2]) subs.push({ index: i, submitter: s[0], answer: s[3] });
  }

  const messages = JSON.stringify([
    { role: "system", content: 'Return JSON only: {"winnerIndex": 0, "summary": "ok"}' },
    {
      role: "user",
      content: `Judge bounty. Title: ${bounty[1]}. Rubric: ${bounty[2]}. Submissions: ${JSON.stringify(subs)}`,
    },
  ]);
  const llmInput = encodeAbiParameters(llmParams, [
    executor, [], 300n, [], "0x", messages, "zai-org/GLM-4.7-FP8",
    0n, "", false, 4096n, "", "", 1n, true, 0n, "medium", "0x", -1n, "auto", "", false, 700n,
    "0x", "0x", -1n, 1000n, "", false, ["", "", ""],
  ]);

  const data = encodeFunctionData({ abi, functionName: "judgeAll", args: [bountyId, llmInput] });
  const bal = await pub.getBalance({ address: account.address });
  console.log("Balance:", formatEther(bal), "RITUAL");

  const request = await wallet.prepareTransactionRequest({
    to: contract,
    data,
    gas: 5_000_000n,
    maxPriorityFeePerGas: 2_000_000_000n,
    maxFeePerGas: 50_000_000_000n,
  });
  console.log("Prepared nonce:", request.nonce, "chainId:", request.chainId, "gas:", request.gas?.toString());
  const serialized = await wallet.signTransaction(request);
  const rpcRes = await fetch(chain.rpcUrls.default.http[0], {
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
  const hash = rpcJson.result as Hex;
  console.log("RPC accepted:", hash);
  console.log("Explorer: https://explorer.ritualfoundation.org/tx/" + hash);

  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 600_000 });
  console.log("Receipt:", receipt.status);

  const finalizeTx = await wallet.writeContract({ address: contract, abi, functionName: "finalizeWinner", args: [bountyId, 0n] });
  await pub.waitForTransactionReceipt({ hash: finalizeTx });
  console.log("Done — bounty finalized, winner index 0");
}

main().catch((e) => {
  console.error("FAILED:", e.shortMessage ?? e.message);
  process.exit(1);
});