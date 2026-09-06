import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/github";
import { securityRefreshService } from "@/lib/security-service";
import { isSecurityContextRepository } from "@/lib/repository-constants";
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
    return NextResponse.json({ error: "Repository security context is limited to tracked repositories." }, { status: 403 });
  }
  if (repository && !isSecurityContextRepository(repository)) {
    return NextResponse.json({ error: "Repository security context is unavailable for this repository." }, { status: 403 });
  }

  try {
    const repositories = (repository ? [repository] : trackedRepositories()).filter(isSecurityContextRepository);
    return NextResponse.json(securityRefreshService().snapshot(repositories, force), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
