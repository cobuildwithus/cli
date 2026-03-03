/* v8 ignore file */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliDeps } from "../types.js";

const CLI_PACKAGE_NAME = "@cobuild/cli";
const SETUP_PNPM_PATH_HINT =
  "Auto-link skipped: unable to locate a trusted pnpm entrypoint for this shell session. Run manually: pnpm link --global";

export type GlobalLinkStatus = "not-requested" | "linked" | "failed" | "skipped";

function firstNonEmptyLine(input: string): string | null {
  for (const line of input.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function resolveSetupPackageRoot(): string | null {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const packageJsonPath = path.join(current, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      try {
        const rawPackage = fs.readFileSync(packageJsonPath, "utf8");
        const parsedPackage = JSON.parse(rawPackage) as { name?: unknown };
        if (parsedPackage.name === CLI_PACKAGE_NAME) {
          return current;
        }
      } catch {
        return null;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveTrustedPnpmExecPath(deps: Pick<CliDeps, "env">): string | null {
  const npmExecPath = (deps.env ?? process.env).npm_execpath?.trim();
  if (!npmExecPath || !path.isAbsolute(npmExecPath)) return null;
  if (!fs.existsSync(npmExecPath)) return null;

  const basename = path.basename(npmExecPath).toLowerCase();
  if (!basename.includes("pnpm")) return null;
  return npmExecPath;
}

function buildTrustedPnpmInvocation(pnpmExecPath: string): { command: string; args: string[] } {
  const normalized = pnpmExecPath.toLowerCase();
  if (normalized.endsWith(".js") || normalized.endsWith(".cjs") || normalized.endsWith(".mjs")) {
    return {
      command: process.execPath,
      args: [pnpmExecPath, "link", "--global"],
    };
  }

  return {
    command: pnpmExecPath,
    args: ["link", "--global"],
  };
}

async function runPnpmLinkGlobal(params: {
  deps: Pick<CliDeps, "runSetupLinkGlobal">;
  cwd: string;
  pnpmExecPath: string;
}): Promise<{ ok: boolean; output: string }> {
  if (params.deps.runSetupLinkGlobal) {
    const invocation = buildTrustedPnpmInvocation(params.pnpmExecPath);
    return await params.deps.runSetupLinkGlobal({
      cwd: params.cwd,
      command: invocation.command,
      args: invocation.args,
    });
  }

  try {
    const { spawn } = await import("node:child_process");
    const invocation = buildTrustedPnpmInvocation(params.pnpmExecPath);
    return await new Promise((resolve) => {
      const output: string[] = [];
      const child = spawn(invocation.command, invocation.args, {
        cwd: params.cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.stdout?.on("data", (chunk) => {
        output.push(chunk.toString("utf8"));
      });
      child.stderr?.on("data", (chunk) => {
        output.push(chunk.toString("utf8"));
      });

      child.once("error", (error) => {
        resolve({
          ok: false,
          output: error instanceof Error ? error.message : String(error),
        });
      });
      child.once("exit", (code) => {
        resolve({
          ok: code === 0,
          output: output.join("").trim(),
        });
      });
    });
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function maybeLinkCliGlobalCommand(
  deps: Pick<CliDeps, "env" | "runSetupLinkGlobal" | "stderr">,
  shouldLink: boolean
): Promise<GlobalLinkStatus> {
  if (!shouldLink) return "not-requested";

  const setupPackageRoot = resolveSetupPackageRoot();
  if (!setupPackageRoot) {
    deps.stderr("Auto-link skipped: could not determine the cli package root.");
    deps.stderr("Run manually: pnpm link --global");
    return "skipped";
  }

  const pnpmExecPath = resolveTrustedPnpmExecPath(deps);
  if (!pnpmExecPath) {
    deps.stderr(SETUP_PNPM_PATH_HINT);
    return "skipped";
  }

  deps.stderr("Installing global `cli` command via pnpm link...");
  const linkResult = await runPnpmLinkGlobal({
    deps,
    cwd: setupPackageRoot,
    pnpmExecPath,
  });
  if (linkResult.ok) {
    deps.stderr("Global command installed. You can now run `cli ...` directly.");
    return "linked";
  }

  const normalizedOutput = linkResult.output.toLowerCase();
  if (
    normalizedOutput.includes("err_pnpm_no_global_bin_dir") ||
    normalizedOutput.includes("unable to find the global bin directory")
  ) {
    deps.stderr("Auto-link failed: pnpm global bin directory is not configured.");
    deps.stderr("Run once: pnpm setup");
    deps.stderr("Then restart your shell and run: pnpm link --global");
    deps.stderr("Until then, run commands via: pnpm start -- <command>");
    return "failed";
  }

  const firstLine = firstNonEmptyLine(linkResult.output);
  if (firstLine) deps.stderr(`Auto-link failed: ${firstLine}`);
  deps.stderr("Auto-link failed. Run manually: pnpm link --global");
  return "failed";
}
