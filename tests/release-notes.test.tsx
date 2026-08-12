import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReleaseNotes } from "@/components/ReleaseNotes";

describe("ReleaseNotes", () => {
  it("drops raw HTML and images while hardening external links", () => {
    const html = renderToStaticMarkup(
      <ReleaseNotes
        product="UDS Core"
        version="1.2.3"
        notes={'# Release notes\n<script>window.stolen = true</script>\n![tracking](https://attacker.example/pixel)\n[Details](https://github.com/example/release)'}
      />,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("window.stolen");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });
});
