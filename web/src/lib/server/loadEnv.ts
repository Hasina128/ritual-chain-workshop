import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Load key=value pairs from hardhat/.env (single source of truth for wallet keys). */
export function loadHardhatEnv(): Record<string, string> {
  const path = resolve(process.cwd(), "../hardhat/.env");
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([^#][^=]+)=(.*)$/);
    if (m) {
      const v = m[2].trim();
      if (v) out[m[1].trim()] = v;
    }
  }
  return out;
}

export function isAutomationEnabled(): boolean {
  return process.env.AUTOMATION_ENABLED !== "false";
}

const SALTS_DIR = resolve(process.cwd(), "data");

export type SaltStore = {
  user1: { answer: string; salt: `0x${string}` };
  user2: { answer: string; salt: `0x${string}` };
};

export function saveSalts(bountyId: bigint, store: SaltStore) {
  mkdirSync(SALTS_DIR, { recursive: true });
  writeFileSync(
    resolve(SALTS_DIR, `bounty-salts-${bountyId}.json`),
    JSON.stringify(store, null, 2),
  );
}

export function loadSalts(bountyId: bigint): SaltStore | null {
  const path = resolve(SALTS_DIR, `bounty-salts-${bountyId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as SaltStore;
}