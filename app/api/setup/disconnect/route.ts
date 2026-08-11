import { NextRequest, NextResponse } from "next/server";
import { clearSessionGitHubToken, currentGitHubViewer, githubRequest, githubTokenStatus } from "@/lib/github";
import { clearSessionGitlabToken, gitlabTokenStatus } from "@/lib/gitlab";
import { readLocalSettings, writeLocalSettings } from "@/lib/local-settings";
import { clearSecurityRegistryTokenCache } from "@/lib/security-oci";
import { clearSessionDefenseRegistryCredentials, defenseRegistryCredentialStatus } from "@/lib/security-registry-auth";
import { securityRefreshService } from "@/lib/security-service";
import { trackedRepositories } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

type GitHubViewer = { login: string };
type Provider = "github" | "gitlab" | "registry";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

async function githubViewer() {
  const current = currentGitHubViewer();
  if (current) return current;
  if (!githubTokenStatus().configured) return null;
  return (await githubRequest<GitHubViewer>("/user", 0).catch(() => null))?.login ?? null;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });

  const body = await request.json().catch(() => null) as { provider?: unknown } | null;
  const provider = body?.provider as Provider | undefined;
  if (provider !== "github" && provider !== "gitlab" && provider !== "registry") {
    return NextResponse.json({ error: "Choose a supported account to disconnect." }, { status: 400 });
  }

  if (provider === "github") {
    const status = githubTokenStatus();
    if (status.source === "environment") {
      return NextResponse.json({ error: "GitHub is configured by an environment variable. Remove it and restart Scout to disconnect." }, { status: 409 });
    }
    clearSessionGitHubToken();
    clearSessionGitlabToken();
    clearSessionDefenseRegistryCredentials();
    clearSecurityRegistryTokenCache();
    return NextResponse.json({ disconnected: "github" });
  }

  if (provider === "registry") {
    const status = defenseRegistryCredentialStatus();
    if (status.source === "environment") {
      return NextResponse.json({ error: "Defense Unicorns Registry credentials are configured by the server environment. Remove them and restart Scout to disconnect." }, { status: 409 });
    }
    clearSessionDefenseRegistryCredentials();
    clearSecurityRegistryTokenCache();
    securityRefreshService().snapshot(trackedRepositories(), true);
    return NextResponse.json({ disconnected: "registry", environmentAvailable: false });
  }

  const status = gitlabTokenStatus();
  const viewer = await githubViewer();
  const settings = readLocalSettings(viewer);
  if (settings) {
    writeLocalSettings({ ...settings, gitlabEnabled: false, gitlabProjects: [], gitlabDefaultProject: null }, viewer);
  }
  clearSessionGitlabToken();
  return NextResponse.json({ disconnected: "gitlab", environmentAvailable: status.source === "environment" });
}
