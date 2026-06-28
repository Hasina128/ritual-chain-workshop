import { NextResponse } from "next/server";
import { createBountyAndCommit } from "@/lib/server/bountyAutomation";
import { isAutomationEnabled } from "@/lib/server/loadEnv";

export async function POST(req: Request) {
  if (!isAutomationEnabled()) {
    return NextResponse.json({ error: "Automation disabled" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as {
      title: string;
      rubric: string;
      reward: string;
      submissionDeadline: number;
      revealDeadline: number;
    };

    if (!body.title?.trim() || !body.rubric?.trim()) {
      return NextResponse.json({ error: "Title and rubric required" }, { status: 400 });
    }
    if (body.revealDeadline <= body.submissionDeadline) {
      return NextResponse.json({ error: "Reveal deadline must be after submission deadline" }, { status: 400 });
    }

    const result = await createBountyAndCommit({
      title: body.title.trim(),
      rubric: body.rubric.trim(),
      reward: body.reward || "0.05",
      submissionDeadline: body.submissionDeadline,
      revealDeadline: body.revealDeadline,
    });

    return NextResponse.json(result);
  } catch (e) {
    const message = (e as Error).message ?? "Create failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}