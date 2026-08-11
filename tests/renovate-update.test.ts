import { describe, expect, it } from "vitest";
import { analyzeRenovateUpdate } from "@/lib/renovate-update";

describe("analyzeRenovateUpdate", () => {
  it("identifies and deduplicates major changes from Renovate tables", () => {
    const body = `
| Package | Update | Change |
|---|---|---|
| [jenkins](https://jenkins.io) | major | \`2.9.0\` -> \`3.0.0\` |
| jenkins | major | 2.9.0 -> 3.0.0 |
`;

    expect(analyzeRenovateUpdate({ body })).toEqual({
      major: true,
      majorChanges: [{ dependency: "jenkins", from: "2.9.0", to: "3.0.0" }],
    });
  });

  it("recognizes explicit major metadata without inventing a version change", () => {
    expect(analyzeRenovateUpdate({ labels: [{ name: "semver-major" }] })).toEqual({ major: true, majorChanges: [] });
    expect(analyzeRenovateUpdate({ head: "renovate/major-jenkins" }).major).toBe(true);
    expect(analyzeRenovateUpdate({ title: "Major version upgrade" }).major).toBe(true);
  });

  it("does not classify patch updates as major", () => {
    const body = `| Dependency | Change |\n|---|---|\n| app | 2.9.0 → 2.9.1 |`;
    expect(analyzeRenovateUpdate({ body })).toEqual({ major: false, majorChanges: [] });
  });
});
