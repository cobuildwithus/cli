import { describe, expect, it } from "vitest";
import {
  parseCliWalletAddressCandidates,
  parseCliWalletAddressForSetupSummary,
} from "../src/api-response-schemas.js";

describe("api response schemas", () => {
  it("parses setup wallet address summary and candidates", () => {
    expect(
      parseCliWalletAddressForSetupSummary({
        wallet: { address: "0xabc" },
      })
    ).toBe("0xabc");
    expect(parseCliWalletAddressForSetupSummary("bad-shape")).toBeNull();

    expect(
      parseCliWalletAddressCandidates({
        result: { ownerAccountAddress: "0x1", wallet: { address: "0x2" } },
        ownerAccountAddress: "0x3",
        wallet: { address: "0x4" },
      })
    ).toEqual({
      resultOwnerAccountAddress: "0x1",
      resultWalletAddress: "0x2",
      ownerAccountAddress: "0x3",
      walletAddress: "0x4",
    });
    expect(parseCliWalletAddressCandidates("bad-shape")).toBeNull();
  });

  it("keeps wallet candidate parsing tolerant when unrelated fields are malformed", () => {
    expect(
      parseCliWalletAddressCandidates({
        result: {
          ownerAccountAddress: "0x1",
          wallet: { address: 123 },
        },
        wallet: "not-an-object",
        ownerAccountAddress: "0x3",
      })
    ).toEqual({
      resultOwnerAccountAddress: "0x1",
      resultWalletAddress: null,
      ownerAccountAddress: "0x3",
      walletAddress: null,
    });
  });
});
