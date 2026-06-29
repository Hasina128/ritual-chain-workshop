import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  formatEther,
  http,
  parseAbi,
  parseAbiParameters,
  parseEther,
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

const LLM = "0x0000000000000000000000000000000000000802" as Address;
const WALLET = "0x532F0dF0896F353d8C3DD8cc134e8129DA2a3948" as Address;
const REGISTRY = "0x9644e8562cE0Fe12b4deeC4163c064A8862Bf47F" as Address;
const executor = (process.env.RITUAL_EXECUTOR_ADDRESS ?? "0xB42e435c4252A5a2E7440e37B609F00c61a0c91B") as Address;

const chain = {
  id: 1979,
  name: "Ritual",
  nativeCurrency: { name: "RITUAL", symbol: "RITUAL", decimals: 18 },
  rpcUrls: { default: { http: [process.env.RITUAL_RPC_URL ?? "https://rpc.ritualfoundation.org"] } },
} as const;

const key = (process.env.CREATOR_PRIVATE_KEY ?? process.env.DEPLOYER_PRIVATE_KEY)!;
const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);

const pub = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });

const walletAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function deposit(uint256) payable",
]);

const llmParams = parseAbiParameters(
  "address,bytes[],uint256,bytes[],bytes,string,string,int256,string,bool,int256,string,string,uint256,bool,int256,string,bytes,int256,string,string,bool,int256,bytes,bytes,int256,int256,string,bool,(string,string,string)",
);

async function main() {
  const [bal, wBal] = await Promise.all([
    pub.getBalance({ address: account.address }),
    pub.readContract({ address: WALLET, abi: walletAbi, functionName: "balanceOf", args: [account.address] }),
  ]);
  console.log("EOA:", formatEther(bal), "RITUAL | RitualWallet:", formatEther(wBal));

  if (wBal < parseEther("0.05")) {
    console.log("Depositing 0.05 to RitualWallet…");
    const d = await wallet.writeContract({
      address: WALLET,
      abi: walletAbi,
      functionName: "deposit",
      args: [100_000n],
      value: parseEther("0.05"),
    });
    await pub.waitForTransactionReceipt({ hash: d });
  }

  const data = encodeAbiParameters(llmParams, [
    executor, [], 300n, [], "0x",
    JSON.stringify([{ role: "user", content: "Reply with exactly: OK" }]),
    "zai-org/GLM-4.7-FP8",
    0n, "", false, 4096n, "", "", 1n, true, 0n, "medium", "0x", -1n, "auto", "", false, 700n,
    "0x", "0x", -1n, 1000n, "", false, ["", "", ""],
  ]);

  console.log("Sending direct LLM precompile call…");
  const hash = await wallet.sendTransaction({ to: LLM, data, gas: 3_000_000n });
  console.log("Hash:", hash);

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const t = await pub.getTransaction({ hash });
      console.log(`poll ${i}:`, t.blockNumber ? `mined block ${t.blockNumber}` : "pending");
      if (t.blockNumber) break;
    } catch {
      console.log(`poll ${i}: gone`);
    }
  }

  try {
    const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
    console.log("Receipt:", receipt.status);
  } catch (e) {
    console.log("No receipt:", (e as Error).message?.slice(0, 80));
  }
}

main().catch((e) => {
  console.error("FAILED:", e.shortMessage ?? e.message);
  process.exit(1);
});