import { NextRequest, NextResponse } from "next/server";
import { clearSecurityRegistryTokenCache } from "@/lib/security-oci";
import { defenseRegistryCredentialStatus, setSessionDefenseRegistryCredentials, validateDefenseRegistryCredentials } from "@/lib/security-registry-auth";
import { securityRefreshService } from "@/lib/security-service";
import { trackedRepositories } from "@/lib/tracked-repositories";

export const runtime = "nodejs";

function sameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Cross-origin setup requests are not allowed." }, { status: 403 });
  if (defenseRegistryCredentialStatus().source === "environment") {
    return NextResponse.json({ error: "Defense Unicorns Registry credentials are configured by the server environment." }, { status: 409 });
  }

  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || username.length > 256 || !password || password.length > 4096) {
      return NextResponse.json({ error: "Enter a valid registry username and password or pull token." }, { status: 400 });
    }
    const registry = await validateDefenseRegistryCredentials(username, password);
    setSessionDefenseRegistryCredentials(username, password);
    clearSecurityRegistryTokenCache();
    securityRefreshService().snapshot(trackedRepositories(), true);
    return NextResponse.json({ connected: true, source: "session", host: registry.host });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Defense Unicorns Registry could not be connected.";
    const status = /rejected these credentials/i.test(message) ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
