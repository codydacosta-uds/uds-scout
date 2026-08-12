import { describe, expect, it } from "vitest";
import { parseImageReference, resolveApplicationIdentity, stableSecurityId } from "@/lib/security-normalization";

describe("security normalization", () => {
  it.each([
    ["nginx", { registryHost: "registry-1.docker.io", repository: "library/nginx", tag: "latest", digest: null }],
    ["ghcr.io/org/app:v1.2.3", { registryHost: "ghcr.io", repository: "org/app", tag: "v1.2.3", digest: null }],
    ["registry.example.mil:5000/team/app@sha256:abc", { registryHost: "registry.example.mil:5000", repository: "team/app", tag: null, digest: "sha256:abc" }],
  ])("parses %s", (reference, expected) => {
    expect(parseImageReference(reference)).toMatchObject(expected);
  });

  it("creates stable opaque identifiers without embedding source values", () => {
    const id = stableSecurityId("secret-project", "CVE-2026-0001");
    expect(id).toMatch(/^[a-f0-9]{24}$/);
    expect(id).toBe(stableSecurityId("secret-project", "CVE-2026-0001"));
    expect(id).not.toContain("secret-project");
  });

  it("keeps test components out of the application queue", () => {
    const identity = resolveApplicationIdentity({
      packageName: "jenkins-tests",
      packageDescription: null,
      packageUpstreamUrl: "https://github.com/jenkinsci/jenkins",
      componentName: "tests",
      chartNames: [],
      chartVersions: [],
      chartUrls: [],
      image: parseImageReference("ghcr.io/example/test-runner:1.0.0"),
    });
    expect(identity).toMatchObject({ role: "support", confidence: "unknown", name: null });
  });

  it("identifies supported application images and strips a leading v from versions", () => {
    const identity = resolveApplicationIdentity({
      packageName: "jenkins",
      packageDescription: null,
      packageUpstreamUrl: "https://github.com/jenkinsci/jenkins",
      componentName: "jenkins",
      chartNames: ["jenkins"],
      chartVersions: ["v2.500.1"],
      chartUrls: ["https://github.com/jenkinsci/helm-charts"],
      image: parseImageReference("docker.io/jenkins/jenkins:v2.500.1"),
    });
    expect(identity).toMatchObject({ name: "Jenkins", version: "2.500.1", role: "application", confidence: "identified" });
  });
});
