import { afterEach, describe, expect, it, vi } from "vitest";
import { CLI_OAUTH_WRITE_SCOPE } from "../src/oauth.js";
import { createHarness } from "./helpers.js";

const mocks = vi.hoisted(() => ({
  requestRefreshTokenViaBrowser: vi.fn(),
}));

vi.mock("../src/setup/oauth-flow.js", async () => {
  const actual = await vi.importActual<typeof import("../src/setup/oauth-flow.js")>(
    "../src/setup/oauth-flow.js"
  );
  return {
    ...actual,
    requestRefreshTokenViaBrowser: (...args: unknown[]) => mocks.requestRefreshTokenViaBrowser(...args),
  };
});

import { executeSetupCommand } from "../src/commands/setup.js";

describe("setup oauth scope selection", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("upgrades hosted setup browser auth to write scope when --write is omitted", async () => {
    const harness = createHarness({
      fetchResponder: async (input) => {
        const url = String(input);
        if (url === "https://chat-api.co.build/oauth/token") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                token_type: "Bearer",
                access_token: "access-token",
                refresh_token: "refresh-token",
                expires_in: 600,
                scope: CLI_OAUTH_WRITE_SCOPE,
                session_id: "session-1",
                can_write: true,
              }),
          };
        }
        if (url === "https://api.example/api/cli/wallet") {
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ ok: true, address: "0xabc" }),
          };
        }
        if (url === "https://api.example/api/cli/wallet?agentKey=default") {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                ok: true,
                result: {
                  ownerAccountAddress: "0x00000000000000000000000000000000000000aa",
                },
              }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });
    harness.deps.isInteractive = () => true;
    mocks.requestRefreshTokenViaBrowser.mockResolvedValue("rfr_from_browser");

    await executeSetupCommand(
      {
        url: "https://api.example",
        walletMode: "hosted",
      },
      harness.deps
    );

    expect(mocks.requestRefreshTokenViaBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: CLI_OAUTH_WRITE_SCOPE,
      })
    );
    expect(harness.errors).toContain(
      "Hosted wallet setup needs write authorization; requesting write scope for browser approval."
    );
  });
});
