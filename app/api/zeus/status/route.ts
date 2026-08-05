import { NextResponse } from "next/server";
import { zeusHealth } from "@/lib/test-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
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
