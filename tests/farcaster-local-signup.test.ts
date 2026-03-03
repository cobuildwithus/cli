import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readContractMock: vi.fn(),
  getBalanceMock: vi.fn(),
  waitForTransactionReceiptMock: vi.fn(),
  sendTransactionMock: vi.fn(),
  signTypedDataMock: vi.fn(),
  evaluatePreflightMock: vi.fn(),
}));

vi.mock("viem", async (importOriginal) => {
  const actual = await importOriginal<typeof import("viem")>();
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: mocks.readContractMock,
      getBalance: mocks.getBalanceMock,
      waitForTransactionReceipt: mocks.waitForTransactionReceiptMock,
    }),
    createWalletClient: () => ({
      sendTransaction: mocks.sendTransactionMock,
    }),
    formatEther: (value: bigint) => value.toString(),
    http: () => ({ transport: "http" }),
  };
});

vi.mock("viem/accounts", () => ({
  generatePrivateKey: () => `0x${"99".repeat(32)}`,
  privateKeyToAccount: () => ({
    address: "0x00000000000000000000000000000000000000aa",
    signTypedData: mocks.signTypedDataMock,
  }),
}));

vi.mock("viem/chains", () => ({
  optimism: {
    id: 10,
    rpcUrls: {
      default: {
        http: ["https://optimism.example"],
      },
    },
  },
}));

vi.mock("@cobuild/wire", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cobuild/wire")>();
  return {
    ...actual,
    FARCASTER_CONTRACTS: {
      idRegistry: "0x0000000000000000000000000000000000000001",
      idGateway: "0x0000000000000000000000000000000000000002",
    },
    FARCASTER_ID_GATEWAY_ABI: [],
    FARCASTER_ID_REGISTRY_ABI: [],
    FARCASTER_SIGNUP_NETWORK: "optimism",
    buildFarcasterSignedKeyRequestMetadata: () => "0xmetadata",
    buildFarcasterSignedKeyRequestTypedData: () => ({
      domain: { name: "SignedKeyRequestValidator", version: "1", chainId: 10, verifyingContract: "0xabc" },
      types: {
        EIP712Domain: [],
        SignedKeyRequest: [],
      },
      primaryType: "SignedKeyRequest",
      message: {
        requestFid: 0n,
        key: `0x${"11".repeat(32)}`,
        deadline: 123n,
      },
    }),
    buildFarcasterSignupCallPlan: () => ({
      registerCall: {
        to: "0x0000000000000000000000000000000000000003",
        value: 7n,
        data: "0xaaa",
      },
      addKeyCall: {
        to: "0x0000000000000000000000000000000000000004",
        value: 0n,
        data: "0xbbb",
      },
    }),
    buildFarcasterSignupExecutableCalls: (plan: {
      registerCall: { to: `0x${string}`; value: bigint; data: `0x${string}` };
      addKeyCall: { to: `0x${string}`; value: bigint; data: `0x${string}` };
    }) => [plan.registerCall, plan.addKeyCall],
    computeFarcasterSignedKeyRequestDeadline: () => 123n,
    evaluateFarcasterSignupPreflight: mocks.evaluatePreflightMock,
  };
});

import {
  executeLocalFarcasterSignup,
  LocalFarcasterAlreadyRegisteredError,
} from "../src/farcaster/local-signup.js";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const SIGNER_PUBLIC_KEY = `0x${"22".repeat(32)}` as const;

describe("farcaster local signup", () => {
  beforeEach(() => {
    mocks.readContractMock.mockReset();
    mocks.getBalanceMock.mockReset();
    mocks.waitForTransactionReceiptMock.mockReset();
    mocks.sendTransactionMock.mockReset();
    mocks.signTypedDataMock.mockReset();
    mocks.evaluatePreflightMock.mockReset();
  });

  it("throws LocalFarcasterAlreadyRegisteredError when the custody address already has an fid", async () => {
    mocks.readContractMock.mockResolvedValueOnce(5n);

    await expect(
      executeLocalFarcasterSignup({
        deps: { env: {} },
        privateKeyHex: PRIVATE_KEY,
        signerPublicKey: SIGNER_PUBLIC_KEY,
      })
    ).rejects.toBeInstanceOf(LocalFarcasterAlreadyRegisteredError);
  });

  it("returns needs_funding when preflight indicates insufficient balance", async () => {
    mocks.readContractMock
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(7n);
    mocks.getBalanceMock.mockResolvedValue(2n);
    mocks.evaluatePreflightMock.mockReturnValue({
      status: "needs_funding",
      requiredWei: "5",
    });

    const result = await executeLocalFarcasterSignup({
      deps: { env: {} },
      privateKeyHex: PRIVATE_KEY,
      signerPublicKey: SIGNER_PUBLIC_KEY,
    });

    expect(result).toEqual({
      status: "needs_funding",
      network: "optimism",
      ownerAddress: "0x00000000000000000000000000000000000000aa",
      custodyAddress: "0x00000000000000000000000000000000000000aa",
      recoveryAddress: "0x00000000000000000000000000000000000000aa",
      idGatewayPriceWei: "7",
      idGatewayPriceEth: "7",
      balanceWei: "2",
      balanceEth: "2",
      requiredWei: "5",
      requiredEth: "5",
    });
  });

  it("returns complete result after register/add-key calls and assigned fid", async () => {
    mocks.readContractMock
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(7n)
      .mockResolvedValueOnce(123n);
    mocks.getBalanceMock.mockResolvedValue(100n);
    mocks.evaluatePreflightMock.mockReturnValue({ status: "ready" });
    mocks.signTypedDataMock.mockResolvedValue(`0x${"33".repeat(65)}`);
    mocks.sendTransactionMock.mockResolvedValueOnce("0xabc").mockResolvedValueOnce("0xdef");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    const result = await executeLocalFarcasterSignup({
      deps: { env: {} },
      privateKeyHex: PRIVATE_KEY,
      signerPublicKey: SIGNER_PUBLIC_KEY,
      recoveryAddress: "0x00000000000000000000000000000000000000bb",
      extraStorage: "2",
    });

    expect(result).toEqual({
      status: "complete",
      network: "optimism",
      ownerAddress: "0x00000000000000000000000000000000000000aa",
      custodyAddress: "0x00000000000000000000000000000000000000aa",
      recoveryAddress: "0x00000000000000000000000000000000000000bb",
      fid: "123",
      idGatewayPriceWei: "7",
      txHash: "0xdef",
    });
    expect(mocks.sendTransactionMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces transaction revert and missing assigned fid errors", async () => {
    mocks.readContractMock.mockResolvedValueOnce(0n).mockResolvedValueOnce(7n);
    mocks.getBalanceMock.mockResolvedValue(100n);
    mocks.evaluatePreflightMock.mockReturnValue({ status: "ready" });
    mocks.signTypedDataMock.mockResolvedValue(`0x${"33".repeat(65)}`);
    mocks.sendTransactionMock.mockResolvedValue("0xabc");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "reverted" });

    await expect(
      executeLocalFarcasterSignup({
        deps: { env: {} },
        privateKeyHex: PRIVATE_KEY,
        signerPublicKey: SIGNER_PUBLIC_KEY,
      })
    ).rejects.toThrow("Local Farcaster signup transaction reverted (tx: 0xabc).");

    mocks.readContractMock
      .mockReset()
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(7n)
      .mockResolvedValueOnce(0n);
    mocks.getBalanceMock.mockResolvedValue(100n);
    mocks.evaluatePreflightMock.mockReturnValue({ status: "ready" });
    mocks.signTypedDataMock.mockResolvedValue(`0x${"33".repeat(65)}`);
    mocks.sendTransactionMock.mockResolvedValueOnce("0xabc").mockResolvedValueOnce("0xdef");
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "success" });

    await expect(
      executeLocalFarcasterSignup({
        deps: { env: {} },
        privateKeyHex: PRIVATE_KEY,
        signerPublicKey: SIGNER_PUBLIC_KEY,
      })
    ).rejects.toThrow("Farcaster signup confirmed but FID was not assigned to custody address.");
  });
});
