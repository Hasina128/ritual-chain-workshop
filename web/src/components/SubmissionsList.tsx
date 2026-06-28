"use client";

import { useReadContract } from "wagmi";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { shortenAddress } from "@/lib/format";
import type { JudgeResult } from "@/lib/aiReview";
import type { Bounty } from "@/lib/bounty";
import { getBountyPhase } from "@/lib/bounty";
import { useNow } from "@/hooks/useNow";
import { Card, CardHeader, CardBody, Badge } from "@/components/ui";

export function SubmissionsList({
  bountyId,
  bounty,
  judge,
  finalWinner,
}: {
  bountyId: bigint;
  bounty: Bounty;
  judge?: JudgeResult | null;
  finalWinner?: number;
}) {
  const count = Number(bounty.submissionCount);
  const indices = Array.from({ length: count }, (_, i) => i);
  const phase = getBountyPhase(bounty);

  return (
    <Card>
      <CardHeader
        title="Submissions"
        subtitle={
          phase === "commit"
            ? "Only commitment hashes are visible during the commit phase."
            : "Answers appear only after a participant reveals."
        }
        action={<Badge tone="zinc">{count}</Badge>}
      />
      <CardBody className="space-y-3">
        {count === 0 ? (
          <p className="text-sm text-zinc-500">No submissions yet.</p>
        ) : (
          indices.map((i) => (
            <SubmissionRow
              key={i}
              bountyId={bountyId}
              index={i}
              phase={phase}
              ranking={judge?.ranking?.find((r) => r.index === i)}
              recommended={judge?.winnerIndex === i}
              isWinner={finalWinner === i}
            />
          ))
        )}
      </CardBody>
    </Card>
  );
}

function SubmissionRow({
  bountyId,
  index,
  phase,
  ranking,
  recommended,
  isWinner,
}: {
  bountyId: bigint;
  index: number;
  phase: ReturnType<typeof getBountyPhase>;
  ranking?: { index: number; score: number; reason: string };
  recommended?: boolean;
  isWinner?: boolean;
}) {
  const { data, isLoading } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "getSubmission",
    args: [bountyId, BigInt(index)],
    chainId: ritualChain.id,
    query: { enabled: !!contractAddress },
  });

  const submitter = data?.[0];
  const commitment = data?.[1];
  const revealed = data?.[2];
  const answer = data?.[3];

  const hideAnswer = !revealed && phase !== "judged" && phase !== "finalized";

  return (
    <div
      className={`rounded-xl border p-3 ${
        isWinner
          ? "border-emerald-500/40 bg-emerald-500/5"
          : recommended
            ? "border-indigo-500/40 bg-indigo-500/5"
            : "border-white/10 bg-black/20"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-500">#{index}</span>
          <span className="font-mono text-sm text-zinc-300">
            {submitter ? shortenAddress(submitter) : isLoading ? "loading…" : "-"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {revealed ? (
            <Badge tone="green">Revealed</Badge>
          ) : (
            <Badge tone="amber">Committed</Badge>
          )}
          {ranking ? <Badge tone="zinc">score {ranking.score}</Badge> : null}
          {isWinner ? (
            <Badge tone="green">Winner</Badge>
          ) : recommended ? (
            <Badge tone="indigo">AI pick</Badge>
          ) : null}
        </div>
      </div>

      {hideAnswer ? (
        <p className="mt-2 font-mono text-xs text-zinc-500">
          commitment {commitment ? `${commitment.slice(0, 10)}…${commitment.slice(-8)}` : "—"}
        </p>
      ) : (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-zinc-200">
          {answer ?? (isLoading ? "" : revealed ? "-" : "Not revealed")}
        </p>
      )}

      {ranking?.reason ? (
        <p className="mt-2 border-t border-white/5 pt-2 text-xs text-zinc-400">
          <span className="text-zinc-500">AI: </span>
          {ranking.reason}
        </p>
      ) : null}
    </div>
  );
}