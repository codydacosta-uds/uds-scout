import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/github";
import { securityRefreshService } from "@/lib/security-service";
import { isSecurityIntelligenceRepository } from "@/lib/repository-constants";
import { isTrackedRepository, trackedRepositories } from "@/lib/tracked-repositories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validRepository(value: string) {
  return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(value);
}

export async function GET(request: NextRequest) {
  const repository = request.nextUrl.searchParams.get("repository");
  const force = request.nextUrl.searchParams.get("refresh") === "true";
  if (repository && (!validRepository(repository) || !isTrackedRepository(repository))) {
    return NextResponse.json({ error: "Security intelligence is limited to tracked repositories." }, { status: 403 });
  }
  if (repository && !isSecurityIntelligenceRepository(repository)) {
    return NextResponse.json({ error: "Security intelligence is not applicable to this repository." }, { status: 403 });
  }

  try {
    const repositories = (repository ? [repository] : trackedRepositories()).filter(isSecurityIntelligenceRepository);
    return NextResponse.json(securityRefreshService().snapshot(repositories, force), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
