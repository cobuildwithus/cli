import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseWorkflowPath = path.join(repoRoot, ".github", "workflows", "release.yml");

describe("release workflow guards", () => {
  it("enforces @cobuild/cli package identity before publish", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain('[[ "${package_name}" == "@cobuild/cli" ]]');
    expect(workflow).toContain("expected @cobuild/cli.");
    expect(workflow).not.toContain("@cobuild/bot");
  });
});
