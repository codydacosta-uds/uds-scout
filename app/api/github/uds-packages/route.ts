import { NextResponse } from "next/server";
import { apiError, githubAllPages, presentRepo, RawRepo } from "@/lib/github";

export const runtime = "nodejs";

const ORGANIZATION = "uds-packages";

export async function GET() {
  try {
    const repositories = await githubAllPages<RawRepo>(
      `/orgs/${ORGANIZATION}/repos?type=all&sort=updated&direction=desc`,
      10,
    );

    return NextResponse.json({
      organization: ORGANIZATION,
      url: `https://github.com/orgs/${ORGANIZATION}/repositories`,
      metrics: {
        total: repositories.length,
        private: repositories.filter((repository) => repository.private).length,
        public: repositories.filter((repository) => !repository.private).length,
        archived: repositories.filter((repository) => repository.archived).length,
      },
      repositories: repositories.map(presentRepo),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const failure = apiError(error);
    return NextResponse.json({ error: failure.message }, { status: failure.status });
  }
}
