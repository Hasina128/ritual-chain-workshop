"use client";

import { useEffect, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useNow } from "@/hooks/useNow";
import aiJudgeAbi from "@/abi/AIJudge";
import { contractAddress } from "@/config/contract";
import { ritualChain } from "@/config/wagmi";
import { canCommit, canReveal, type Bounty } from "@/lib/bounty";
import {
  computeCommitment,
  generateSalt,
  loadRevealSalt,
  storeRevealSalt,
} from "@/lib/commitment";
import { useWriteTx } from "@/hooks/useWriteTx";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Textarea,
  Button,
  TxStatus,
  Notice,
} from "@/components/ui";

const explorerBase = ritualChain.blockExplorers?.default.url;

export function SubmitAnswer({
  bountyId,
  bounty,
  onSubmitted,
}: {
  bountyId: bigint;
  bounty: Bounty;
  onSubmitted: () => void;
}) {
  const { address, isConnected } = useAccount();
  const [answer, setAnswer] = useState("");
  const [savedSalt, setSavedSalt] = useState<`0x${string}` | null>(null);
  const now = useNow();


  const commitTx = useWriteTx(() => {
    setAnswer("");
    onSubmitted();
  });
  const revealTx = useWriteTx(() => onSubmitted());

  const { data: hasCommitted } = useReadContract({
    address: contractAddress,
    abi: aiJudgeAbi,
    functionName: "hasCommitted",
    args:
      address && bountyId !== undefined
        ? [bountyId, address]
        : undefined,
    chainId: ritualChain.id,
    query: { enabled: !!contractAddress && !!address },
  });

  useEffect(() => {
    if (!address) return;
    const saved = loadRevealSalt({ bountyId, submitter: address });
    if (saved) {
      setSavedSalt(saved.salt);
      if (!answer) setAnswer(saved.answer);
    }
  }, [address, bountyId, answer]);

  const showCommit = canCommit(bounty, now) && !hasCommitted;
  const showReveal = canReveal(bounty, now) && hasCommitted === true;

  if (!showCommit && !showReveal) return null;

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    if (!answer.trim() || !contractAddress || !address) return;

    const trimmed = answer.trim();
    const salt = generateSalt();
    const commitment = computeCommitment({
      bountyId,
      answer: trimmed,
      salt,
      submitter: address,
    });

    storeRevealSalt({ bountyId, submitter: address, salt, answer: trimmed });
    setSavedSalt(salt);

    try {
      await commitTx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "submitCommitment",
        args: [bountyId, commitment],
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  async function handleReveal(e: React.FormEvent) {
    e.preventDefault();
    if (!contractAddress || !address) return;

    const saved = loadRevealSalt({ bountyId, submitter: address });
    if (!saved) {
      window.alert(
        "Reveal salt not found in this browser. Re-enter your exact answer and salt if you saved them elsewhere.",
      );
      return;
    }

    try {
      await revealTx.run({
        address: contractAddress,
        abi: aiJudgeAbi,
        functionName: "revealAnswer",
        args: [bountyId, saved.answer, saved.salt],
        chainId: ritualChain.id,
      });
    } catch {
      /* surfaced via tx.state */
    }
  }

  if (showReveal) {
    return (
      <Card>
        <CardHeader
          title="Reveal your answer"
          subtitle="Reveal phase is open. Your commitment was stored — reveal to become eligible for judging."
        />
        <CardBody>
          <form onSubmit={handleReveal} className="space-y-3">
            {savedSalt ? (
              <Notice tone="indigo">
                Salt found locally for this bounty. Click reveal to publish your
                answer on-chain.
              </Notice>
            ) : (
              <Notice tone="amber">
                No local salt found. If you committed from another browser, you
                must reveal manually with your saved answer and salt.
              </Notice>
            )}
            <Button
              type="submit"
              disabled={!isConnected || !savedSalt || revealTx.isBusy}
              className="w-full"
            >
              {revealTx.isBusy ? "Revealing…" : "Reveal answer"}
            </Button>
            {!isConnected && (
              <p className="text-xs text-zinc-500">
                Connect your wallet to reveal.
              </p>
            )}
            <TxStatus
              state={revealTx.state}
              error={revealTx.error}
              hash={revealTx.hash}
              explorerBase={explorerBase}
            />
          </form>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Submit a commitment"
        subtitle="Only a hash is stored on-chain until the reveal phase. Save your answer locally — you will need it to reveal."
      />
      <CardBody>
        <form onSubmit={handleCommit} className="space-y-3">
          <Field label="Your answer">
            <Textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={5}
              placeholder="Write your submission…"
            />
          </Field>
          <Button
            type="submit"
            disabled={!isConnected || !answer.trim() || commitTx.isBusy}
            className="w-full"
          >
            {commitTx.isBusy ? "Submitting commitment…" : "Submit commitment"}
          </Button>
          {!isConnected && (
            <p className="text-xs text-zinc-500">
              Connect your wallet to submit.
            </p>
          )}
          <TxStatus
            state={commitTx.state}
            error={commitTx.error}
            hash={commitTx.hash}
            explorerBase={explorerBase}
          />
        </form>
      </CardBody>
    </Card>
  );
}