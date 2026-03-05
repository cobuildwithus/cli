import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoToolsRoot = path.resolve(repoRoot, "../repo-tools");
const docsDriftBin = path.join(repoToolsRoot, "bin", "cobuild-check-agent-docs-drift");
const cleanupPaths: string[] = [];

const requiredDocFiles = [
  "agent-docs/index.md",
  "ARCHITECTURE.md",
  "AGENTS.md",
  "agent-docs/PLANS.md",
  "agent-docs/RELIABILITY.md",
  "agent-docs/SECURITY.md",
  "agent-docs/QUALITY_SCORE.md",
  "agent-docs/cli-architecture.md",
  "agent-docs/prompts/simplify.md",
  "agent-docs/prompts/test-coverage-audit.md",
  "agent-docs/prompts/task-finish-review.md",
  "agent-docs/references/README.md",
  "agent-docs/references/module-boundary-map.md",
  "agent-docs/references/cli-command-and-data-flow.md",
  "agent-docs/references/testing-ci-map.md",
  "agent-docs/generated/README.md",
  "agent-docs/generated/doc-inventory.md",
  "agent-docs/generated/doc-gardening-report.md",
  "agent-docs/exec-plans/active/README.md",
  "agent-docs/exec-plans/completed/README.md",
  "agent-docs/exec-plans/tech-debt-tracker.md",
];

type CmdResult = { status: number | null; stdout: string; stderr: string };

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

function run(command: string, args: string[], cwd: string, env: Record<string, string> = {}): CmdResult {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

const docsDriftEnv = {
  COBUILD_DRIFT_REQUIRED_FILES: `${requiredDocFiles.join("\n")}\n`,
  COBUILD_DRIFT_CODE_CHANGE_PATTERN:
    "^(src/|scripts/|package\\.json$|README\\.md$|ARCHITECTURE\\.md$|AGENTS\\.md$)",
  COBUILD_DRIFT_CODE_CHANGE_LABEL: "Architecture-sensitive code/process",
  COBUILD_DRIFT_ALLOW_RELEASE_ARTIFACTS_ONLY: "1",
};

function expectSuccess(result: CmdResult): void {
  expect(result.status).toBe(0);
}

function combinedOutput(result: CmdResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

function setupFixtureRepo(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "cli-docs-drift-test-"));
  cleanupPaths.push(root);

  for (const relPath of requiredDocFiles) {
    const filePath = path.join(root, relPath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `# ${relPath}\n`);
  }

  writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "@cobuild/cli", version: "0.1.0" }, null, 2)}\n`
  );
  writeFileSync(path.join(root, "README.md"), "# CLI\n");

  expectSuccess(run("git", ["init", "-q"], root));
  expectSuccess(run("git", ["config", "user.email", "123456+cli-docs-drift@users.noreply.github.com"], root));
  expectSuccess(run("git", ["config", "user.name", "Docs Drift Test"], root));
  expectSuccess(run("git", ["add", "."], root));
  expectSuccess(run("git", ["commit", "-m", "chore: baseline"], root));

  return root;
}

describe("check-agent-docs-drift release commit behavior", () => {
  it("passes for release-artifacts-only commit shape", () => {
    const root = setupFixtureRepo();

    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "@cobuild/cli", version: "0.1.1" }, null, 2)}\n`
    );
    writeFileSync(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [0.1.1] - 2026-02-25\n");
    mkdirSync(path.join(root, "release-notes"), { recursive: true });
    writeFileSync(path.join(root, "release-notes", "v0.1.1.md"), "0.1.1 Latest\n");

    expectSuccess(run("git", ["add", "."], root));
    expectSuccess(run("git", ["commit", "-m", "chore(release): v0.1.1"], root));

    const drift = run(docsDriftBin, [], root, docsDriftEnv);
    const output = combinedOutput(drift);
    expect(drift.status).toBe(0);
    expect(output).toContain("Agent docs drift checks passed.");
  });

  it("fails when architecture-sensitive files change without docs or active plan", () => {
    const root = setupFixtureRepo();

    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify({ name: "@cobuild/cli", version: "0.1.0", private: true }, null, 2)}\n`
    );
    expectSuccess(run("git", ["add", "package.json"], root));
    expectSuccess(run("git", ["commit", "-m", "chore: toggle package privacy"], root));

    const drift = run(docsDriftBin, [], root, docsDriftEnv);
    const output = combinedOutput(drift);
    expect(drift.status).toBe(1);
    expect(output).toContain("Architecture-sensitive code/process changed");
  });

  it("passes for staged dependency-only package metadata changes even with unrelated unstaged dirt", () => {
    const root = setupFixtureRepo();

    writeFileSync(
      path.join(root, "package.json"),
      `${JSON.stringify(
        {
          name: "@cobuild/cli",
          version: "0.1.0",
          dependencies: {
            chalk: "^5.4.0",
          },
        },
        null,
        2
      )}\n`
    );
    writeFileSync(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    expectSuccess(run("git", ["add", "package.json", "pnpm-lock.yaml"], root));

    writeFileSync(path.join(root, "README.md"), "# CLI unstaged dirt\n");

    const drift = run(docsDriftBin, [], root, docsDriftEnv);
    const output = combinedOutput(drift);
    expect(drift.status).toBe(0);
    expect(output).toContain("Agent docs drift checks passed.");
  });

  it("passes when only the coordination ledger changes without updating the docs index", () => {
    const root = setupFixtureRepo();

    writeFileSync(
      path.join(root, "agent-docs", "exec-plans", "active", "COORDINATION_LEDGER.md"),
      "# COORDINATION_LEDGER\n\n| task_id | goal | scope | owner | status | updated |\n| --- | --- | --- | --- | --- | --- |\n| task-1 | test drift gate | `scripts/check-agent-docs-drift.sh` | codex | active | 2026-03-05 |\n"
    );
    expectSuccess(run("git", ["add", "agent-docs/exec-plans/active/COORDINATION_LEDGER.md"], root));

    const drift = run(docsDriftBin, [], root, docsDriftEnv);
    const output = combinedOutput(drift);
    expect(drift.status).toBe(0);
    expect(output).toContain("Agent docs drift checks passed.");
  });
});
