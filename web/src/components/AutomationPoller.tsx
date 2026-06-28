"use client";

import { useEffect, useState } from "react";
import { Notice, Spinner } from "@/components/ui";

export function AutomationPoller({
  bountyId,
  onUpdate,
}: {
  bountyId: bigint;
  onUpdate: () => void;
}) {
  const [status, setStatus] = useState<string>("Automation running…");
  const [phase, setPhase] = useState<string>("commit");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      try {
        const res = await fetch("/api/bounty/advance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bountyId: bountyId.toString() }),
        });
        const data = (await res.json()) as {
          phase?: string;
          message?: string;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Automation failed");
          return;
        }
        setPhase(data.phase ?? "unknown");
        setStatus(data.message ?? "Working…");
        onUpdate();

        if (data.phase === "finalized") return;
        if (data.phase === "error") {
          setError(data.message ?? "Error");
          return;
        }
        timer = setTimeout(tick, 20_000);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }

    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [bountyId, onUpdate]);

  if (error) {
    return <Notice tone="red">Automation: {error}</Notice>;
  }

  if (phase === "finalized") {
    return <Notice tone="green">Automation complete — bounty finalized on-chain.</Notice>;
  }

  return (
    <Notice tone="indigo">
      <span className="inline-flex items-center gap-2">
        <Spinner />
        <span>
          <strong>No MetaMask needed.</strong> Server automation ({phase}): {status}
        </span>
      </span>
    </Notice>
  );
}