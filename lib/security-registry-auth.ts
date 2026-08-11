import "server-only";

const DEFENSE_REGISTRY_HOST = "registry.defenseunicorns.com";

type DefenseRegistryCredentials = { username: string; password: string };
type DefenseRegistryRuntime = typeof globalThis & {
  __udsScoutDefenseRegistryUsername?: string;
  __udsScoutDefenseRegistryPassword?: string;
};

const runtimeState = globalThis as DefenseRegistryRuntime;

function environmentCredentials(): DefenseRegistryCredentials | null {
  const username = (process.env.UDS_SCOUT_DEFENSE_REGISTRY_USERNAME ?? process.env.UDS_SCOUT_CGR_USERNAME)?.trim();
  const password = process.env.UDS_SCOUT_DEFENSE_REGISTRY_PASSWORD ?? process.env.UDS_SCOUT_CGR_PASSWORD;
  return username && password ? { username, password } : null;
}

export function defenseRegistryCredentialStatus() {
  if (environmentCredentials()) return { configured: true, source: "environment" as const };
  if (runtimeState.__udsScoutDefenseRegistryUsername && runtimeState.__udsScoutDefenseRegistryPassword) return { configured: true, source: "session" as const };
  return { configured: false, source: null };
}

export function defenseRegistryCredentials(): DefenseRegistryCredentials | null {
  return environmentCredentials() ?? (runtimeState.__udsScoutDefenseRegistryUsername && runtimeState.__udsScoutDefenseRegistryPassword
    ? { username: runtimeState.__udsScoutDefenseRegistryUsername, password: runtimeState.__udsScoutDefenseRegistryPassword }
    : null);
}

export function defenseRegistryAuthorization() {
  const credentials = defenseRegistryCredentials();
  return credentials ? `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}` : undefined;
}

export function setSessionDefenseRegistryCredentials(username: string, password: string) {
  runtimeState.__udsScoutDefenseRegistryUsername = username;
  runtimeState.__udsScoutDefenseRegistryPassword = password;
}

export function clearSessionDefenseRegistryCredentials() {
  delete runtimeState.__udsScoutDefenseRegistryUsername;
  delete runtimeState.__udsScoutDefenseRegistryPassword;
}

export async function validateDefenseRegistryCredentials(username: string, password: string) {
  const response = await fetch(`https://${DEFENSE_REGISTRY_HOST}/v2/`, {
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`, "User-Agent": "uds-scout-security" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) throw new Error("Defense Unicorns Registry rejected these credentials.");
  if (!response.ok) throw new Error(`Defense Unicorns Registry validation returned ${response.status}.`);
  return { host: DEFENSE_REGISTRY_HOST };
}
