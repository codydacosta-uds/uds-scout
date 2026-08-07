import { NextResponse } from "next/server";
import { TEST_LAB_ENABLED } from "@/lib/repository-constants";
import { zeusHealth } from "@/lib/test-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!TEST_LAB_ENABLED) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  try {
    return NextResponse.json(await zeusHealth(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Zeus host status is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
