import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { POST_RECEIPT_VERSION } from "../src/farcaster/constants.js";
import {
  ensurePayerConfigForPost,
  printX402FundingHints,
  runX402InitWorkflow,
} from "../src/farcaster/payer.js";
import {
  buildPostResultPayload,
  decodeMessageBytesBase64,
  readPostReceipt,
  writePostReceipt,
} from "../src/farcaster/receipt.js";
import type { CliConfig } from "../src/types.js";

function makeTempHomedir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cli-farcaster-modules-"));
}

function baseConfig(agent = "default"): CliConfig {
  return {
    url: "https://api.example",
    chatApiUrl: "https://chat.example",
    agent,
    auth: {
      tokenRef: {
        source: "env",
        provider: "env",
        id: "token",
      },
    },
  };
}

describe("farcaster payer module coverage", () => {
  it("prints hosted funding hints when payer address is not known", () => {
    const lines: string[] = [];
    printX402FundingHints(
      {
        stderr(line) {
          lines.push(line);
        },
      },
      {
        mode: "hosted",
        payerAddress: null,
      }
    );

    expect(lines.join("\n")).toContain("Payer address is not available yet");
    expect(lines.join("\n")).toContain("Hosted mode requires CLI auth");
  });

  it("throws clear setup guidance when payer config is missing in non-interactive mode", async () => {
    const homedir = makeTempHomedir();

    await expect(
      ensurePayerConfigForPost({
        deps: {
          fs,
          homedir: () => homedir,
          env: {},
          fetch: vi.fn(),
          readStdin: async () => "",
          isInteractive: () => false,
          stderr: vi.fn(),
        },
        currentConfig: baseConfig(),
        agentKey: "default",
      })
    ).rejects.toThrow("Missing payer config");
  });

  it("validates payer setup mode and supports local-key stdin flow", async () => {
    const homedir = makeTempHomedir();
    const baseDeps = {
      fs,
      homedir: () => homedir,
      env: {},
      fetch: vi.fn(),
      readStdin: async () => `0x${"11".repeat(32)}`,
      isInteractive: () => false,
      stderr: vi.fn(),
    } as const;

    await expect(
      runX402InitWorkflow({
        deps: baseDeps,
        currentConfig: baseConfig(),
        agentKey: "default",
        modeArg: undefined,
        noPrompt: true,
        privateKeyStdin: false,
        privateKeyFile: undefined,
      })
    ).rejects.toThrow("Missing --mode in non-interactive mode");

    await expect(
      runX402InitWorkflow({
        deps: baseDeps,
        currentConfig: baseConfig(),
        agentKey: "default",
        modeArg: "local-key",
        noPrompt: true,
        privateKeyStdin: true,
        privateKeyFile: "/tmp/key",
      })
    ).rejects.toThrow("Provide only one of --private-key-stdin or --private-key-file");

    await expect(
      runX402InitWorkflow({
        deps: baseDeps,
        currentConfig: baseConfig(),
        agentKey: "default",
        modeArg: "invalid-mode",
        noPrompt: true,
        privateKeyStdin: false,
        privateKeyFile: undefined,
      })
    ).rejects.toThrow("--mode must be one of");

    const localResult = await runX402InitWorkflow({
      deps: baseDeps,
      currentConfig: baseConfig(),
      agentKey: "default",
      modeArg: "local-key",
      noPrompt: true,
      privateKeyStdin: true,
      privateKeyFile: undefined,
    });

    expect(localResult.mode).toBe("local");
    expect(localResult.payerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});

describe("farcaster receipt module coverage", () => {
  it("reads legacy receipts and rejects malformed payloads", () => {
    const homedir = makeTempHomedir();
    const receiptPath = path.join(homedir, "receipt.json");

    fs.writeFileSync(receiptPath, "{bad-json", "utf8");
    expect(() => readPostReceipt({ deps: { fs }, receiptPath })).toThrow(
      "Farcaster post idempotency receipt is invalid"
    );

    const legacy = {
      version: POST_RECEIPT_VERSION,
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      request: {
        fid: 123,
        text: "legacy",
      },
      result: {
        castHashHex: `0x${"ab".repeat(20)}`,
        hubResponseStatus: 200,
        hubResponseText: "ok",
      },
      savedAt: new Date().toISOString(),
    };
    fs.writeFileSync(receiptPath, JSON.stringify(legacy), "utf8");

    const parsed = readPostReceipt({ deps: { fs }, receiptPath });
    expect(parsed?.state).toBe("succeeded");
    expect(parsed?.request.verify).toBe(false);
  });

  it("writes receipts with and without atomic rename fallback", () => {
    const homedir = makeTempHomedir();
    const receiptPath = path.join(homedir, "receipts", "one.json");
    const receipt = {
      version: POST_RECEIPT_VERSION,
      idempotencyKey: "00000000-0000-4000-8000-000000000002",
      state: "pending" as const,
      request: {
        fid: 100,
        text: "hello",
        verify: false,
      },
      castHashHex: `0x${"cd".repeat(20)}` as `0x${string}`,
      messageBytesBase64: "aGVsbG8=",
      savedAt: new Date().toISOString(),
    };

    writePostReceipt({ deps: { fs }, receiptPath, receipt });
    expect(fs.existsSync(receiptPath)).toBe(true);

    const fallbackFs = {
      ...fs,
      renameSync: undefined,
    } as unknown as typeof fs;
    const fallbackPath = path.join(homedir, "receipts", "two.json");
    writePostReceipt({ deps: { fs: fallbackFs }, receiptPath: fallbackPath, receipt });
    expect(fs.existsSync(fallbackPath)).toBe(true);
  });

  it("surfaces decode and post-result payload edge cases", () => {
    expect(() => decodeMessageBytesBase64(" ")).toThrow("missing message bytes");

    const payload = buildPostResultPayload({
      fid: 123,
      text: "ship",
      castHashHex: `0x${"ef".repeat(20)}`,
      fallbackAgentKey: "default",
      result: {
        hubResponseStatus: 200,
        hubResponseText: "   ",
      },
    });

    expect(payload.hubResponse).toBe("");
    expect(payload.payerAgentKey).toBe("default");
  });
});
