import {
  encodePacked,
  keccak256,
  type Address,
  type Hex,
} from "viem";

/** keccak256(abi.encodePacked(answer, salt, submitter, bountyId)) */
export function computeCommitment({
  bountyId,
  answer,
  salt,
  submitter,
}: {
  bountyId: bigint;
  answer: string;
  salt: Hex;
  submitter: Address;
}): Hex {
  return keccak256(
    encodePacked(
      ["string", "bytes32", "address", "uint256"],
      [answer, salt, submitter, bountyId],
    ),
  );
}

/** Generate a random 32-byte salt for commit-reveal submissions. */
export function generateSalt(): Hex {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

const SALT_STORAGE_PREFIX = "ritual-bounty-salt";

export function storeRevealSalt({
  bountyId,
  submitter,
  salt,
  answer,
}: {
  bountyId: bigint;
  submitter: Address;
  salt: Hex;
  answer: string;
}) {
  const key = `${SALT_STORAGE_PREFIX}:${bountyId.toString()}:${submitter.toLowerCase()}`;
  localStorage.setItem(
    key,
    JSON.stringify({ salt, answer, savedAt: Date.now() }),
  );
}

export function loadRevealSalt({
  bountyId,
  submitter,
}: {
  bountyId: bigint;
  submitter: Address;
}): { salt: Hex; answer: string } | null {
  const key = `${SALT_STORAGE_PREFIX}:${bountyId.toString()}:${submitter.toLowerCase()}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { salt: Hex; answer: string };
    if (!parsed.salt || !parsed.answer) return null;
    return parsed;
  } catch {
    return null;
  }
}