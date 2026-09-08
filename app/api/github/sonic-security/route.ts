import { NextRequest, NextResponse } from "next/server";
import { queryNvdApplicationAdvisories } from "@/lib/security-advisories";
import { SECURITY_PRODUCT_PROFILES, normalizeAdvisoryVersion } from "@/lib/security-products";
import { SONIC_REPOSITORY } from "@/lib/repository-constants";

export const runtime = "nodejs";

type PackageInput = { name?: unknown; version?: unknown };
function cpeValue(value: string) { return value.replace(/[^a-zA-Z0-9._-]/g, "_"); }
function version(value: string) { return normalizeAdvisoryVersion(value).replace(/-uds(?:\.[0-9]+)?-(?:upstream|registry1|unicorn).*$/i, ""); }

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "The security request must be valid JSON." }, { status: 400 }); }
  const input = body && typeof body === "object" ? body as { repository?: unknown; packages?: unknown } : {};
  if (input.repository !== SONIC_REPOSITORY || !Array.isArray(input.packages) || input.packages.length > 30) return NextResponse.json({ error: "Security coverage is limited to the current SONIC bundle." }, { status: 400 });
  const packages = input.packages.filter((item): item is PackageInput => Boolean(item) && typeof item === "object");
  const results: Record<string, { status: "critical" | "high" | "incomplete" | "not-evaluated"; vulnerabilities: string[] }> = {};
  await Promise.all(packages.map(async (item) => {
    const name = typeof item.name === "string" ? item.name : "";
    const rawVersion = typeof item.version === "string" ? item.version : "";
    const profile = SECURITY_PRODUCT_PROFILES.find((candidate) => candidate.aliases.some((alias) => alias.test(name)));
    if (!name || !rawVersion || !profile?.cpe) { if (name) results[name] = { status: "not-evaluated", vulnerabilities: [] }; return; }
    try {
      const advisoryMatches = await queryNvdApplicationAdvisories(`cpe:2.3:a:${cpeValue(profile.cpe.vendor)}:${cpeValue(profile.cpe.product)}:${cpeValue(version(rawVersion))}:*:*:*:*:*:*:*`, version(rawVersion));
      const severe = advisoryMatches.filter((match) => match.vulnerability.severity === "critical" || match.vulnerability.severity === "high");
      results[name] = { status: severe.some((match) => match.vulnerability.severity === "critical") ? "critical" : severe.length ? "high" : "incomplete", vulnerabilities: severe.map((match) => match.vulnerability.id) };
    } catch { results[name] = { status: "incomplete", vulnerabilities: [] }; }
  }));
  return NextResponse.json({ results });
}
