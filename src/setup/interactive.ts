/* v8 ignore file */
import type { CliDeps } from "../types.js";
import type { GlobalLinkStatus } from "./link.js";

export const CLI_PRIMARY_COMMAND = "cobuild";

export function printSetupWizardIntro(deps: Pick<CliDeps, "stderr">): void {
  deps.stderr("");
  deps.stderr("================================");
  deps.stderr("CLI Setup Wizard");
  deps.stderr("================================");
  deps.stderr("This wizard will save your CLI config and verify wallet access.");
}

export function printSetupStep(
  deps: Pick<CliDeps, "stderr">,
  step: number,
  total: number,
  title: string
): void {
  deps.stderr("");
  deps.stderr(`[${step}/${total}] ${title}`);
}

export function printSetupSuccessSummary(params: {
  deps: Pick<CliDeps, "stderr">;
  configPath: string;
  defaultNetwork: string;
  walletAddress: string | null;
  payer?: {
    mode: "hosted" | "local";
    payerAddress: string | null;
    network: string;
    token: string;
    costPerPaidCallMicroUsdc: string;
  };
  linkStatus: GlobalLinkStatus;
}): void {
  params.deps.stderr("");
  params.deps.stderr("Setup complete.");
  params.deps.stderr(`Config saved: ${params.configPath}`);
  if (params.walletAddress) {
    params.deps.stderr(`Wallet address: ${params.walletAddress}`);
  }
  params.deps.stderr(`Default network: ${params.defaultNetwork}`);
  if (params.payer) {
    params.deps.stderr(`Wallet payer mode: ${params.payer.mode}`);
    if (params.payer.payerAddress) {
      params.deps.stderr(`Wallet payer address: ${params.payer.payerAddress}`);
    }
  }
  params.deps.stderr("");
  params.deps.stderr("Next:");
  params.deps.stderr(`  ${CLI_PRIMARY_COMMAND} wallet`);
  params.deps.stderr(
    `  ${CLI_PRIMARY_COMMAND} send usdc 0.10 <to> (or ${CLI_PRIMARY_COMMAND} send eth 0.00001 <to>)`
  );
  if (params.linkStatus === "not-requested") {
    params.deps.stderr(
      `If ${CLI_PRIMARY_COMMAND} is not on your PATH, run \`pnpm link --global\` once (or use: \`npx -y @cobuild/cli@latest <command>\`).`
    );
  }
}

export async function promptLine(question: string, defaultValue?: string): Promise<string> {
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || defaultValue || "";
  } finally {
    rl.close();
  }
}

export async function promptSecret(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("Cannot prompt for token without a TTY. Pass --token <refresh-token> instead.");
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stderr = process.stderr;
    stderr.write(`${question}: `);

    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      try {
        stdin.setRawMode(false);
      } catch {
        // ignore cleanup errors
      }
      stdin.pause();
    };

    const onData = (chunk: Buffer | string) => {
      const str = chunk.toString("utf8");
      for (const ch of str) {
        if (ch === "\n" || ch === "\r") {
          cleanup();
          stderr.write("\n");
          resolve(value.trim());
          return;
        }
        if (ch === "\u0003") {
          cleanup();
          stderr.write("\n");
          reject(new Error("Setup cancelled"));
          return;
        }
        if (ch === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        value += ch;
      }
    };

    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
