import { describe, expect, it, vi } from "vitest";
import { parseImageReference } from "@/lib/security-normalization";
import { resolveImageManifest } from "@/lib/security-oci";

describe("OCI network boundary", () => {
  it.each([
    "localhost/app:1",
    "127.0.0.1/app:1",
    "10.0.0.8/app:1",
    "100.64.0.1/app:1",
    "169.254.169.254/latest:1",
    "172.16.0.1/app:1",
    "192.168.1.1/app:1",
    "[::1]/app:1",
    "[fd00::1]/app:1",
  ])("blocks local and private registry address %s before network access", async (reference) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(resolveImageManifest(parseImageReference(reference))).rejects.toThrow(/local or private registry/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
