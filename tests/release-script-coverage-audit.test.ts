import { chmodSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type RepoFixture = {
  repoDir: string;
  pathEnv: string;
  packageJsonPath: string;
};

const testRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanupPaths: string[] = [];
const releaseScriptNames = ["release.sh", "update-changelog.sh", "generate-release-notes.sh"] as const;

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const target = cleanupPaths.pop();
    if (target) {
      rmSync(target, { recursive: true, force: true });
    }
  }
});

function run(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string> = {}
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function writeExecutable(filePath: string, content: string): void {
  writeFileSync(filePath, content);
  chmodSync(filePath, 0o755);
}

function createRepoFixture(opts?: { packageName?: string }): RepoFixture {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "buildbot-release-audit-"));
  cleanupPaths.push(tempDir);

  const repoDir = path.join(tempDir, "repo");
  const binDir = path.join(tempDir, "bin");
  const remoteDir = path.join(tempDir, "remote.git");
  mkdirSync(repoDir);
  mkdirSync(binDir);
  mkdirSync(path.join(repoDir, "scripts"), { recursive: true });

  for (const scriptName of releaseScriptNames) {
    const sourcePath = path.join(testRoot, "scripts", scriptName);
    const targetPath = path.join(repoDir, "scripts", scriptName);
    cpSync(sourcePath, targetPath);
    chmodSync(targetPath, 0o755);
  }

  writeFileSync(
    path.join(repoDir, "package.json"),
    `${JSON.stringify(
      {
        name: opts?.packageName ?? "@cobuild/bot",
        version: "0.1.0",
      },
      null,
      2
    )}\n`
  );
  writeFileSync(path.join(repoDir, "CHANGELOG.md"), "# Changelog\n");

  writeExecutable(
    path.join(binDir, "pnpm"),
    `#!/usr/bin/env bash
set -euo pipefail
exit 0
`
  );

  writeExecutable(
    path.join(binDir, "npm"),
    `#!/usr/bin/env bash
set -euo pipefail
command="\${1:-}"
if [ -z "$command" ]; then
  echo "missing npm command" >&2
  exit 2
fi
shift || true

case "$command" in
  pack)
    exit 0
    ;;
  version)
    tag="\${NPM_STUB_NEW_TAG:-v0.1.1}"
    version="\${tag#v}"
    node -e '
const fs = require("node:fs");
const packageJsonPath = "package.json";
const data = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
data.version = process.argv[1];
fs.writeFileSync(packageJsonPath, JSON.stringify(data, null, 2) + "\\n");
' "$version"
    echo "$tag"
    exit 0
    ;;
  *)
    echo "unsupported npm stub command: $command" >&2
    exit 2
    ;;
esac
`
  );

  const pathEnv = `${binDir}:${process.env.PATH ?? ""}`;
  expect(run("git", ["init", "--initial-branch=main"], repoDir).status).toBe(0);
  expect(
    run("git", ["config", "user.email", "release-audit-tests@users.noreply.github.com"], repoDir)
      .status
  ).toBe(0);
  expect(run("git", ["config", "user.name", "Release Audit"], repoDir).status).toBe(0);
  // Avoid inheriting global signing policy that can break fixture commits/tags in CI or local dev.
  expect(run("git", ["config", "commit.gpgsign", "false"], repoDir).status).toBe(0);
  expect(run("git", ["config", "tag.gpgSign", "false"], repoDir).status).toBe(0);
  expect(run("git", ["init", "--bare", remoteDir], repoDir).status).toBe(0);
  expect(run("git", ["remote", "add", "origin", remoteDir], repoDir).status).toBe(0);
  expect(run("git", ["add", "."], repoDir).status).toBe(0);
  expect(run("git", ["commit", "-m", "chore: baseline"], repoDir).status).toBe(0);

  return {
    repoDir,
    pathEnv,
    packageJsonPath: path.join(repoDir, "package.json"),
  };
}

function runReleaseScript(
  fixture: RepoFixture,
  args: string[],
  env: Record<string, string> = {}
): { status: number | null; stdout: string; stderr: string } {
  return run("bash", ["scripts/release.sh", ...args], fixture.repoDir, {
    PATH: fixture.pathEnv,
    ...env,
  });
}

describe("release.sh coverage audit", () => {
  it("check mode enforces the exact package identity guard", () => {
    const fixture = createRepoFixture({ packageName: "@cobuildwithus/buildbot" });

    const result = runReleaseScript(fixture, ["check"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Error: unexpected package name '@cobuildwithus/buildbot' (expected @cobuild/bot)."
    );
  });

  it("rejects prerelease channels outside alpha/beta/rc", () => {
    const fixture = createRepoFixture();

    const result = runReleaseScript(fixture, ["preminor", "--preid", "preview", "--allow-non-main"]);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Error: --preid must be one of alpha|beta|rc.");
  });

  it("supports exact semver actions and restores package.json in dry-run mode", () => {
    const fixture = createRepoFixture();
    const before = readFileSync(fixture.packageJsonPath, "utf8");

    const result = runReleaseScript(
      fixture,
      ["1.2.3-rc.1", "--dry-run", "--allow-non-main"],
      { NPM_STUB_NEW_TAG: "v1.2.3-rc.1" }
    );

    const after = readFileSync(fixture.packageJsonPath, "utf8");
    const dirtyStatus = run("git", ["status", "--porcelain"], fixture.repoDir);
    const tags = run("git", ["tag", "--list"], fixture.repoDir);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Dry run only.");
    expect(result.stdout).toContain("Would prepare release: @cobuild/bot@1.2.3-rc.1");
    expect(after).toBe(before);
    expect(dirtyStatus.stdout.trim()).toBe("");
    expect(tags.stdout.trim()).toBe("");
  });
});
