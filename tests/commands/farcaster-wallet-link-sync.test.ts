import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHarness } from "../helpers.js";

const mocks = vi.hoisted(() => ({
  executeFarcasterPostCommand: vi.fn(),
  executeBaseFarcasterSignupCommand: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("../../src/farcaster/command.js", () => ({
  executeFarcasterPostCommand: (...args: unknown[]) =>
    mocks.executeFarcasterPostCommand(...args),
  executeFarcasterSignupCommand: (...args: unknown[]) =>
    mocks.executeBaseFarcasterSignupCommand(...args),
}));

vi.mock("../../src/transport.js", () => ({
  apiPost: (...args: unknown[]) => mocks.apiPost(...args),
}));

import { executeFarcasterSignupCommand } from "../../src/commands/farcaster.js";

describe("commands/farcaster wallet-link sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("syncs the custody address after a complete signup", async () => {
    const harness = createHarness();
    mocks.executeBaseFarcasterSignupCommand.mockResolvedValueOnce({
      ok: true,
      result: {
        status: "complete",
        network: "optimism",
        ownerAddress: "0x0000000000000000000000000000000000000001",
        custodyAddress: "0x0000000000000000000000000000000000000002",
        recoveryAddress: "0x0000000000000000000000000000000000000001",
        fid: "123",
        idGatewayPriceWei: "7000000000000000",
        txHash: `0x${"aa".repeat(32)}`,
      },
      signer: {
        publicKey: "0xsigner",
        saved: true,
        file: "farcaster-signer.json",
      },
    });
    mocks.apiPost.mockResolvedValueOnce({
      ok: true,
      fid: 123,
      address: "0x0000000000000000000000000000000000000002",
    });

    const result = await executeFarcasterSignupCommand({}, harness.deps);

    expect(mocks.apiPost).toHaveBeenCalledWith(
      harness.deps,
      "/v1/farcaster/profiles/link-wallet",
      {
        fid: 123,
        address: "0x0000000000000000000000000000000000000002",
      },
    );
    expect(result).toMatchObject({
      walletLinkSync: {
        ok: true,
        fid: 123,
        address: "0x0000000000000000000000000000000000000002",
      },
    });
  });

  it("skips the sync when signup still needs funding", async () => {
    const harness = createHarness();
    mocks.executeBaseFarcasterSignupCommand.mockResolvedValueOnce({
      ok: true,
      result: {
        status: "needs_funding",
        network: "optimism",
        ownerAddress: "0x0000000000000000000000000000000000000001",
        custodyAddress: "0x0000000000000000000000000000000000000002",
        recoveryAddress: "0x0000000000000000000000000000000000000001",
        idGatewayPriceWei: "7000000000000000",
        idGatewayPriceEth: "0.007",
        balanceWei: "0",
        balanceEth: "0",
        requiredWei: "7200000000000000",
        requiredEth: "0.0072",
      },
    });

    const result = await executeFarcasterSignupCommand({}, harness.deps);

    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("walletLinkSync");
  });

  it("returns a partial failure payload when sync fails after signup succeeds", async () => {
    const harness = createHarness();
    mocks.executeBaseFarcasterSignupCommand.mockResolvedValueOnce({
      ok: true,
      result: {
        status: "complete",
        network: "optimism",
        ownerAddress: "0x0000000000000000000000000000000000000001",
        custodyAddress: "0x0000000000000000000000000000000000000002",
        recoveryAddress: "0x0000000000000000000000000000000000000001",
        fid: "456",
        idGatewayPriceWei: "7000000000000000",
        txHash: `0x${"bb".repeat(32)}`,
      },
    });
    mocks.apiPost.mockRejectedValueOnce(new Error("Request failed (status 503): upstream unavailable"));

    const result = await executeFarcasterSignupCommand({}, harness.deps);

    expect(result).toMatchObject({
      walletLinkSync: {
        ok: false,
        fid: 456,
        address: "0x0000000000000000000000000000000000000002",
        error: "Request failed (status 503): upstream unavailable",
      },
    });
  });

  it("falls back to the default sync error when the failure message is empty", async () => {
    const harness = createHarness();
    mocks.executeBaseFarcasterSignupCommand.mockResolvedValueOnce({
      ok: true,
      result: {
        status: "complete",
        network: "optimism",
        ownerAddress: "0x0000000000000000000000000000000000000001",
        custodyAddress: "0x0000000000000000000000000000000000000002",
        recoveryAddress: "0x0000000000000000000000000000000000000001",
        fid: "789",
        idGatewayPriceWei: "7000000000000000",
        txHash: `0x${"cc".repeat(32)}`,
      },
    });
    mocks.apiPost.mockRejectedValueOnce(new Error("   "));

    const result = await executeFarcasterSignupCommand({}, harness.deps);

    expect(result).toMatchObject({
      walletLinkSync: {
        ok: false,
        fid: 789,
        address: "0x0000000000000000000000000000000000000002",
        error: "Failed to sync Farcaster wallet link.",
      },
    });
  });

  it("falls back to the default sync error when the thrown value is not an Error", async () => {
    const harness = createHarness();
    mocks.executeBaseFarcasterSignupCommand.mockResolvedValueOnce({
      ok: true,
      result: {
        status: "complete",
        network: "optimism",
        ownerAddress: "0x0000000000000000000000000000000000000001",
        custodyAddress: "0x0000000000000000000000000000000000000002",
        recoveryAddress: "0x0000000000000000000000000000000000000001",
        fid: "790",
        idGatewayPriceWei: "7000000000000000",
        txHash: `0x${"dd".repeat(32)}`,
      },
    });
    mocks.apiPost.mockRejectedValueOnce("boom");

    const result = await executeFarcasterSignupCommand({}, harness.deps);

    expect(result).toMatchObject({
      walletLinkSync: {
        ok: false,
        fid: 790,
        address: "0x0000000000000000000000000000000000000002",
        error: "Failed to sync Farcaster wallet link.",
      },
    });
  });
});
