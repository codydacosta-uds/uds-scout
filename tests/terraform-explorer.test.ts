import { describe, expect, it } from "vitest";
import { analyzeTerraform } from "@/lib/terraform-explorer";

const base = {
  repository: "nswccd-devsecops/sonic-swf-iac",
  branch: "main",
  sourceRevision: "a".repeat(40),
  rootPath: "iac/swf",
  environments: ["stg", "prd"],
};

describe("Terraform Explorer analysis", () => {
  it("derives dependencies from references rather than file proximity", async () => {
    const result = await analyzeTerraform({
      ...base,
      files: [{
        path: "network.tf",
        content: `
data "aws_vpc" "existing" {
  id = var.vpc_id
}

resource "aws_security_group" "app" {
  vpc_id = data.aws_vpc.existing.id
}

resource "aws_s3_bucket" "unrelated" {
  bucket = "example-bucket"
}
`,
      }],
    });

    const group = result.nodes.find((node) => node.id === "aws_security_group.app");
    const bucket = result.nodes.find((node) => node.id === "aws_s3_bucket.unrelated");
    expect(group?.dependencies).toEqual(["data.aws_vpc.existing"]);
    expect(bucket?.dependencies).toEqual([]);
    expect(result.edges).toEqual([expect.objectContaining({ source: "aws_security_group.app", target: "data.aws_vpc.existing", relationship: "depends-on" })]);
    expect(result.nodes.find((node) => node.kind === "data")?.managed).toBe(false);
  });

  it("hides sensitive variable defaults and output values", async () => {
    const result = await analyzeTerraform({
      ...base,
      files: [{
        path: "secrets.tf",
        content: `
variable "password" {
  type      = string
  sensitive = true
  default   = "must-not-appear"
}

output "password" {
  value     = "must-not-appear"
  sensitive = true
}
`,
      }],
    });

    expect(result.variables[0]).toMatchObject({ sensitive: true, defaultValue: "Sensitive value hidden" });
    expect(result.outputs[0]).toMatchObject({ sensitive: true, value: "Sensitive value hidden" });
    expect(JSON.stringify({ variables: result.variables, outputs: result.outputs })).not.toContain("must-not-appear");
  });

  it("records malformed HCL as a warning without discarding valid files", async () => {
    const result = await analyzeTerraform({
      ...base,
      files: [
        { path: "broken.tf", content: `resource "aws_s3_bucket" "broken" {` },
        { path: "valid.tf", content: `resource "aws_s3_bucket" "valid" { bucket = "valid-name" }` },
      ],
    });
    expect(result.warnings).toEqual([expect.stringContaining("broken.tf could not be parsed")]);
    expect(result.nodes.some((node) => node.id === "aws_s3_bucket.valid")).toBe(true);
  });

  it("connects a root local module to its internal implementation nodes", async () => {
    const result = await analyzeTerraform({
      ...base,
      files: [
        { path: "main.tf", content: `module "network" { source = "./modules/network" }` },
        { path: "modules/network/main.tf", content: `resource "aws_vpc" "this" { cidr_block = "10.0.0.0/16" }` },
      ],
    });
    expect(result.edges).toContainEqual(expect.objectContaining({ source: "module.network", target: "module.network::aws_vpc.this", relationship: "contains" }));
  });
});
