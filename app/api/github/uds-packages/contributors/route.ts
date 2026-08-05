import { NextResponse } from "next/server";
import { apiError, githubAllPages, githubContributorCount, RawRepo } from "@/lib/github";

export const runtime = "nodejs";

const ORGANIZATION = "uds-packages";
const CONCURRENCY = 8;

async function contributorCounts(repositories: RawRepo[]) {
  const results = new Array<{ repository: string; count: number | null }>(repositories.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < repositories.length) {
      const index = nextIndex;
      nextIndex += 1;
      const repository = repositories[index];
      try {
        results[index] = {
          repository: repository.full_name,
          count: await githubContributorCount(repository.full_name),
        };
      } catch {
        results[index] = { repository: repository.full_name, count: null };
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return results;
}

export async function GET() {
  try {
    const repositories = await githubAllPages<RawRepo>(
      `/orgs/${ORGANIZATION}/repos?type=all&sort=updated&direction=desc`,
      10,
    );
    const contributors = await contributorCounts(repositories);

    return NextResponse.json({
      contributors,
      unavailable: contributors.filter((item) => item.count === null).length,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
