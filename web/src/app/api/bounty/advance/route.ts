import { NextResponse } from "next/server";
import { advanceBounty } from "@/lib/server/bountyAutomation";
import { isAutomationEnabled } from "@/lib/server/loadEnv";

export async function POST(req: Request) {
  if (!isAutomationEnabled()) {
    return NextResponse.json({ error: "Automation disabled" }, { status: 403 });
  }

  try {
    const { bountyId } = (await req.json()) as { bountyId: string };
    if (!bountyId) {
      return NextResponse.json({ error: "bountyId required" }, { status: 400 });
    }

    const result = await advanceBounty(BigInt(bountyId));
    return NextResponse.json(result);
  } catch (e) {
    const message = (e as Error).message ?? "Advance failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}