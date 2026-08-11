import { describe, expect, it } from "vitest";
import { containerFindingCategory, parseSbom, sbomAssociationText } from "@/lib/security-sbom";

describe("SBOM parsing", () => {
  it("parses and deduplicates SPDX packages", () => {
    const packageEntry = {
      name: "lodash",
      versionInfo: "4.17.21",
      externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/lodash@4.17.21" }],
    };
    const result = parseSbom({ spdxVersion: "SPDX-2.3", packages: [packageEntry, packageEntry] });
    expect(result).toEqual({
      format: "spdx",
      packages: [expect.objectContaining({ name: "lodash", version: "4.17.21", ecosystem: "npm" })],
    });
  });

  it("unwraps base64 in-toto payloads and parses CycloneDX", () => {
    const document = { bomFormat: "CycloneDX", components: [{ name: "requests", version: "2.32.0", purl: "pkg:pypi/requests@2.32.0" }] };
    const result = parseSbom({ payload: Buffer.from(JSON.stringify(document)).toString("base64") });
    expect(result?.format).toBe("cyclonedx");
    expect(result?.packages[0]).toMatchObject({ name: "requests", ecosystem: "PyPI" });
  });

  it("returns null for malformed and unsupported documents", () => {
    expect(parseSbom(null)).toBeNull();
    expect(parseSbom({ payload: "not-base64-json" })).toBeNull();
    expect(parseSbom({ bomFormat: "unknown" })).toBeNull();
  });

  it("classifies OS, language, and other packages", () => {
    expect(containerFindingCategory({ name: "openssl", version: "1", type: "deb", ecosystem: null, purl: null, cpe: null, supplier: null })).toBe("container-os");
    expect(containerFindingCategory({ name: "react", version: "19", type: "npm", ecosystem: null, purl: null, cpe: null, supplier: null })).toBe("container-language");
    expect(containerFindingCategory({ name: "app", version: "1", type: "binary", ecosystem: null, purl: null, cpe: null, supplier: null })).toBe("container-other");
  });

  it("handles values that cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(sbomAssociationText(circular)).toBe("");
  });
});
