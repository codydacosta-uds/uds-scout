export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSecurityMonitor } = await import("./lib/security-monitor");
    startSecurityMonitor();
  }
}
