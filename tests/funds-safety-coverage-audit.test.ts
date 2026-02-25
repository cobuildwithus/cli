import { describe, expect, it, vi } from "vitest";
import { runCliFromProcess } from "../src/cli.js";
import { apiPost } from "../src/transport.js";
import { createHarness } from "./helpers.js";

const EXPLICIT_UUID = "75d6e51f-4f27-4f17-b32f-4708fdb0f3be";
const GENERATED_UUID = "8e03978e-40d5-43e8-bc93-6894a57f9324";
const VALID_TO = "0x000000000000000000000000000000000000dEaD";

function createJsonResponder(body: unknown, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

describe("funds safety coverage audit", () => {
  it("runCliFromProcess send failure reports explicit idempotency key", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: false, error: "backend unavailable" }, 503),
    });

    await runCliFromProcess(
      [
        "node",
        "buildbot",
        "send",
        "usdc",
        "1.0",
        VALID_TO,
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    expect(harness.errors[0]).toContain(`idempotency key: ${EXPLICIT_UUID}`);
    expect(harness.errors[0]).not.toContain(`idempotency key: ${GENERATED_UUID}`);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("runCliFromProcess tx failure reports explicit idempotency key", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
      fetchResponder: createJsonResponder({ ok: false, error: "backend unavailable" }, 503),
    });

    await runCliFromProcess(
      [
        "node",
        "buildbot",
        "tx",
        "--to",
        VALID_TO,
        "--data",
        "0xdeadbeef",
        "--idempotency-key",
        EXPLICIT_UUID,
      ],
      harness.deps
    );

    expect(harness.errors[0]).toContain(`idempotency key: ${EXPLICIT_UUID}`);
    expect(harness.errors[0]).not.toContain(`idempotency key: ${GENERATED_UUID}`);
    expect(harness.exitCodes).toEqual([1]);
  });

  it("apiPost rejects reserved content-type header overrides regardless of case", async () => {
    const harness = createHarness({
      config: {
        url: "https://api.example",
        token: "bbt_secret",
      },
    });

    await expect(
      apiPost(harness.deps, "/api/buildbot/wallet", {}, { headers: { "Content-Type": "text/plain" } })
    ).rejects.toThrow("Custom headers must not override reserved header: Content-Type");

    await expect(
      apiPost(harness.deps, "/api/buildbot/wallet", {}, { headers: { Authorization: "Bearer other" } })
    ).rejects.toThrow("Custom headers must not override reserved header: Authorization");

    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("apiPost uses the default timeout when timeoutMs is omitted", async () => {
    vi.useFakeTimers();

    try {
      const harness = createHarness({
        config: {
          url: "https://api.example",
          token: "bbt_secret",
        },
        fetchResponder: async (_input, init) =>
          await new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
            });
          }),
      });

      const request = apiPost(harness.deps, "/api/buildbot/wallet", {});
      const rejection = expect(request).rejects.toThrow("Request timed out after 30000ms");
      await vi.advanceTimersByTimeAsync(30_000);
      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
