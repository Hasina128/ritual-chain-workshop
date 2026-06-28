"use client";

import { useMemo, useState } from "react";
import { parseEther } from "viem";
import { isContractConfigured } from "@/config/contract";
import {
  Card,
  CardHeader,
  CardBody,
  Field,
  Input,
  Textarea,
  Button,
  Notice,
} from "@/components/ui";

function defaultDeadline(offsetMinutes: number): string {
  const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function CreateBountyForm({
  onCreated,
}: {
  onCreated?: (bountyId: bigint, autoRun: boolean) => void;
}) {
  const [title, setTitle] = useState("");
  const [rubric, setRubric] = useState("");
  const [submissionDeadline, setSubmissionDeadline] = useState(defaultDeadline(3));
  const [revealDeadline, setRevealDeadline] = useState(defaultDeadline(8));
  const [reward, setReward] = useState("0.05");
  const [createdId, setCreatedId] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const validation = useMemo(() => {
    if (!title.trim()) return "Title is required.";
    if (!rubric.trim()) return "Rubric is required.";
    if (!submissionDeadline || !revealDeadline) return "Pick both deadlines.";
    const subTs = new Date(submissionDeadline).getTime();
    const revTs = new Date(revealDeadline).getTime();
    if (!Number.isFinite(subTs) || !Number.isFinite(revTs)) return "Invalid deadline.";
    if (revTs <= subTs) return "Reveal deadline must be after submission deadline.";
    if (reward !== "") {
      try {
        parseEther(reward);
      } catch {
        return "Reward must be a valid number.";
      }
    }
    return null;
  }, [title, rubric, submissionDeadline, revealDeadline, reward]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (validation || !isContractConfigured) return;

    const submissionMs = new Date(submissionDeadline).getTime();
    const revealMs = new Date(revealDeadline).getTime();
    if (submissionMs <= Date.now()) {
      window.alert("Submission deadline must be in the future.");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus("Creating bounty + committing user1 & user2 on-chain (no MetaMask)…");
    setCreatedId(null);

    try {
      const res = await fetch("/api/bounty/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          rubric: rubric.trim(),
          reward: reward.trim() || "0.05",
          submissionDeadline: submissionMs,
          revealDeadline: revealMs,
        }),
      });
      const data = (await res.json()) as {
        bountyId?: string;
        message?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Create failed");

      const id = BigInt(data.bountyId!);
      setCreatedId(id);
      setStatus(data.message ?? "Created.");
      onCreated?.(id, true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Create a bounty"
        subtitle="Fill the form — server signs all txs using keys from hardhat/.env. No MetaMask."
      />
      <CardBody>
        {!isContractConfigured && (
          <Notice tone="amber">
            Set <code className="font-mono">NEXT_PUBLIC_CONTRACT_ADDRESS</code> in{" "}
            <code className="font-mono">web/.env.local</code>.
          </Notice>
        )}

        <Notice tone="indigo" >
          Keys live in <code className="font-mono">hardhat/.env</code> (CREATOR, USER1, USER2).
          Reward <strong>0.05</strong> RITUAL recommended. Use short deadlines (3 min / 8 min defaults).
        </Notice>

        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <Field label="Title">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Best gas-optimization writeup"
              maxLength={200}
            />
          </Field>

          <Field label="Rubric">
            <Textarea
              value={rubric}
              onChange={(e) => setRubric(e.target.value)}
              rows={4}
              placeholder="Correctness 50%, clarity 30%, novelty 20%…"
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Submission deadline">
              <Input
                type="datetime-local"
                value={submissionDeadline}
                onChange={(e) => setSubmissionDeadline(e.target.value)}
              />
            </Field>
            <Field label="Reveal deadline">
              <Input
                type="datetime-local"
                value={revealDeadline}
                onChange={(e) => setRevealDeadline(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Reward (RITUAL)">
            <Input
              type="number"
              min="0"
              step="any"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              placeholder="0.05"
            />
          </Field>

          {validation && (title || rubric || reward) ? (
            <p className="text-xs text-amber-300">{validation}</p>
          ) : null}

          <Button
            type="submit"
            disabled={!isContractConfigured || !!validation || busy}
            className="w-full"
          >
            {busy ? "Running on-chain…" : "Create bounty + start automation"}
          </Button>

          {error && <Notice tone="red">{error}</Notice>}
          {status && !error && <Notice tone="green">{status}</Notice>}

          {createdId !== null && (
            <Notice tone="green">
              Bounty <span className="font-mono font-semibold">#{createdId.toString()}</span> — automation
              will reveal, judge, and finalize automatically.
            </Notice>
          )}
        </form>
      </CardBody>
    </Card>
  );
}