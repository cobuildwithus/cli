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

  it("uses pnpm/action-setup without explicit version pin to honor packageManager lock", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");
    const setupPnpmBlock = workflow.match(
      /- name: Setup pnpm[\s\S]*?- name: Setup Node/
    )?.[0];

    expect(setupPnpmBlock).toBeDefined();
    expect(workflow).toContain("uses: pnpm/action-setup@v4");
    expect(setupPnpmBlock).not.toContain("version:");
  });

  it("runs docs gates in release workflow before build/publish", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf8");

    expect(workflow).toContain("- name: Check docs drift");
    expect(workflow).toContain("run: pnpm docs:drift");
    expect(workflow).toContain("- name: Check doc gardening");
    expect(workflow).toContain("run: pnpm docs:gardening");
  });
});
