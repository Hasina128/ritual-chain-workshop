import type { Address } from "viem";
import { nowMs, toDisplayMs } from "./ritualTime";

/** Parsed shape of the `getBounty` tuple return value. */
export type Bounty = {
  owner: Address;
  title: string;
  rubric: string;
  reward: bigint;
  submissionDeadline: bigint;
  revealDeadline: bigint;
  judged: boolean;
  finalized: boolean;
  submissionCount: bigint;
  revealedCount: bigint;
  winnerIndex: bigint;
  aiReview: `0x${string}`;
};

/** getBounty returns a positional tuple — map it to a named object. */
export function parseBounty(
  raw: readonly [
    Address,
    string,
    string,
    bigint,
    bigint,
    bigint,
    boolean,
    boolean,
    bigint,
    bigint,
    bigint,
    `0x${string}`,
  ],
): Bounty {
  const [
    owner,
    title,
    rubric,
    reward,
    submissionDeadline,
    revealDeadline,
    judged,
    finalized,
    submissionCount,
    revealedCount,
    winnerIndex,
    aiReview,
  ] = raw;
  return {
    owner,
    title,
    rubric,
    reward,
    submissionDeadline,
    revealDeadline,
    judged,
    finalized,
    submissionCount,
    revealedCount,
    winnerIndex,
    aiReview,
  };
}

export type BountyPhase =
  | "commit"
  | "reveal"
  | "ready"
  | "judged"
  | "finalized";

function deadlineMs(value: bigint): number {
  return toDisplayMs(value);
}

export function getBountyPhase(b: Bounty, now = nowMs()): BountyPhase {
  if (b.finalized) return "finalized";
  if (b.judged) return "judged";
  if (deadlineMs(b.revealDeadline) <= now) return "ready";
  if (deadlineMs(b.submissionDeadline) <= now) return "reveal";
  return "commit";
}

export const PHASE_META: Record<
  BountyPhase,
  { label: string; tone: "green" | "amber" | "indigo" | "zinc" }
> = {
  commit: { label: "Commit phase", tone: "green" },
  reveal: { label: "Reveal phase", tone: "indigo" },
  ready: { label: "Ready for judging", tone: "amber" },
  judged: { label: "Judged", tone: "indigo" },
  finalized: { label: "Finalized", tone: "zinc" },
};

/** Can a participant still submit a commitment? */
export function canCommit(b: Bounty, now = nowMs()): boolean {
  return (
    !b.judged &&
    !b.finalized &&
    deadlineMs(b.submissionDeadline) > now
  );
}

/** Can a participant reveal a previously committed answer? */
export function canReveal(b: Bounty, now = nowMs()): boolean {
  return (
    !b.judged &&
    !b.finalized &&
    deadlineMs(b.submissionDeadline) <= now &&
    deadlineMs(b.revealDeadline) > now
  );
}

/** Can the owner trigger batch judging? */
export function canJudge(b: Bounty, now = nowMs()): boolean {
  return (
    !b.judged &&
    !b.finalized &&
    deadlineMs(b.revealDeadline) <= now &&
    b.revealedCount > 0n
  );
}