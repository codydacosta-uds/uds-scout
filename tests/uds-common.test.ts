import { describe, expect, it } from "vitest";
import { parseUdsCommonIncludes } from "@/lib/uds-common";

describe("parseUdsCommonIncludes", () => {
  it("finds GitHub and raw UDS Common includes and normalizes versions", () => {
    const result = parseUdsCommonIncludes(`
includes:
  - common:
      url: https://raw.githubusercontent.com/defenseunicorns/uds-common/v1.2.3/tasks.yaml
  - name: deploy-common
    url: https://github.com/defenseunicorns/uds-common/releases/download/2.0.0/tasks.yaml
`);

    expect(result).toEqual([
      expect.objectContaining({ version: "1.2.3" }),
      expect.objectContaining({ name: "deploy-common", version: "2.0.0" }),
    ]);
  });

  it("deduplicates includes and ignores unrelated URLs", () => {
    const url = "https://github.com/defenseunicorns/uds-common/v1.0.0/tasks.yaml";
    expect(parseUdsCommonIncludes(`includes: [${url}, ${url}, https://example.com/tasks.yaml]`)).toHaveLength(1);
  });

  it("throws for malformed YAML so callers can report unknown configuration", () => {
    expect(() => parseUdsCommonIncludes("includes: [unterminated")).toThrow();
  });
});
