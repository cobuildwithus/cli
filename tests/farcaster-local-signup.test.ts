import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readContractMock: vi.fn(),
  getBalanceMock: vi.fn(),
  waitForTransactionReceiptMock: vi.fn(),
  sendTransactionMock: vi.fn(),
  signTypedDataMock: vi.fn(),
  planFarcasterSignupMock: vi.fn(),
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
    planFarcasterSignup: (...args: unknown[]) => mocks.planFarcasterSignupMock(...args),
  };
});

import {
  executeLocalFarcasterSignup,
  LocalFarcasterAlreadyRegisteredError,
} from "../src/farcaster/local-signup.js";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as `0x${string}`;
const SIGNER_PUBLIC_KEY = `0x${"22".repeat(32)}` as const;
const REGISTER_TX_HASH = `0x${"ab".repeat(32)}`;
const ADD_KEY_TX_HASH = `0x${"cd".repeat(32)}`;

function buildReadyPlan() {
  return {
    status: "ready" as const,
    network: "optimism" as const,
    ownerAddress: "0x00000000000000000000000000000000000000aa",
    custodyAddress: "0x00000000000000000000000000000000000000aa",
    recoveryAddress: "0x00000000000000000000000000000000000000bb",
    extraStorage: "2",
    idGatewayPriceWei: "7",
    typedData: {
      domain: {
        name: "SignedKeyRequestValidator",
        version: "1",
        chainId: 10,
        verifyingContract: "0xabc",
      },
      types: {
        EIP712Domain: [],
        SignedKeyRequest: [],
      },
      primaryType: "SignedKeyRequest" as const,
      message: {
        requestFid: 0n,
        key: SIGNER_PUBLIC_KEY,
        deadline: 123n,
      },
    },
    buildExecution: vi.fn(),
    buildExecutableCalls: vi.fn(() => [
      {
        to: "0x0000000000000000000000000000000000000003",
        value: 7n,
        data: "0xaaa",
      },
      {
        to: "0x0000000000000000000000000000000000000004",
        value: 0n,
        data: "0xbbb",
      },
    ]),
    buildCompletedResult: vi.fn(({ fid, txHash }: { fid: bigint; txHash: `0x${string}` }) => ({
      status: "complete" as const,
      network: "optimism" as const,
      ownerAddress: "0x00000000000000000000000000000000000000aa",
      custodyAddress: "0x00000000000000000000000000000000000000aa",
      recoveryAddress: "0x00000000000000000000000000000000000000bb",
      fid: fid.toString(),
      idGatewayPriceWei: "7",
      txHash,
    })),
  };
}

describe("farcaster local signup", () => {
  beforeEach(() => {
    mocks.readContractMock.mockReset();
    mocks.getBalanceMock.mockReset();
    mocks.waitForTransactionReceiptMock.mockReset();
    mocks.sendTransactionMock.mockReset();
    mocks.signTypedDataMock.mockReset();
    mocks.planFarcasterSignupMock.mockReset();
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
    mocks.planFarcasterSignupMock.mockReturnValue({
      status: "needs_funding",
      network: "optimism",
      ownerAddress: "0x00000000000000000000000000000000000000aa",
      custodyAddress: "0x00000000000000000000000000000000000000aa",
      recoveryAddress: "0x00000000000000000000000000000000000000aa",
      idGatewayPriceWei: "7",
      idGatewayPriceEth: "0.000000000000000007",
      balanceWei: "2",
      balanceEth: "0.000000000000000002",
      requiredWei: "5",
      requiredEth: "0.000000000000000005",
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
      idGatewayPriceEth: "0.000000000000000007",
      balanceWei: "2",
      balanceEth: "0.000000000000000002",
      requiredWei: "5",
      requiredEth: "0.000000000000000005",
    });
  });

  it("returns complete result after register/add-key calls and assigned fid", async () => {
    mocks.readContractMock
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(7n)
      .mockResolvedValueOnce(123n);
    mocks.getBalanceMock.mockResolvedValue(100n);
    mocks.planFarcasterSignupMock.mockReturnValue(buildReadyPlan());
    mocks.signTypedDataMock.mockResolvedValue(`0x${"33".repeat(65)}`);
    mocks.sendTransactionMock
      .mockResolvedValueOnce(REGISTER_TX_HASH)
      .mockResolvedValueOnce(ADD_KEY_TX_HASH);
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
      txHash: ADD_KEY_TX_HASH,
    });
    expect(mocks.planFarcasterSignupMock).toHaveBeenCalledWith({
      ownerAddress: "0x00000000000000000000000000000000000000aa",
      custodyAddress: "0x00000000000000000000000000000000000000aa",
      recoveryAddress: "0x00000000000000000000000000000000000000bb",
      signerPublicKey: SIGNER_PUBLIC_KEY,
      existingFid: 0n,
      idGatewayPriceWei: 7n,
      balanceWei: 100n,
      extraStorage: 2n,
    });
    expect(mocks.readContractMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        functionName: "price",
        args: [2n],
      })
    );
    expect(mocks.sendTransactionMock).toHaveBeenCalledTimes(2);
    expect(mocks.sendTransactionMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        to: "0x0000000000000000000000000000000000000003",
        value: 7n,
        data: "0xaaa",
      })
    );
    expect(mocks.sendTransactionMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        to: "0x0000000000000000000000000000000000000004",
        value: 0n,
        data: "0xbbb",
      })
    );
  });

  it("surfaces transaction revert and missing assigned fid errors", async () => {
    mocks.readContractMock.mockResolvedValueOnce(0n).mockResolvedValueOnce(7n);
    mocks.getBalanceMock.mockResolvedValue(100n);
    mocks.planFarcasterSignupMock.mockReturnValue(buildReadyPlan());
    mocks.signTypedDataMock.mockResolvedValue(`0x${"33".repeat(65)}`);
    mocks.sendTransactionMock.mockResolvedValue(REGISTER_TX_HASH);
    mocks.waitForTransactionReceiptMock.mockResolvedValue({ status: "reverted" });

    await expect(
      executeLocalFarcasterSignup({
        deps: { env: {} },
        privateKeyHex: PRIVATE_KEY,
        signerPublicKey: SIGNER_PUBLIC_KEY,
      })
    ).rejects.toThrow(`Local Farcaster signup transaction reverted (tx: ${REGISTER_TX_HASH}).`);

    mocks.readContractMock
      .mockReset()
      .mockResolvedValueOnce(0n)
      .mockResolvedValueOnce(7n)
      .mockResolvedValueOnce(0n);
    mocks.getBalanceMock.mockResolvedValue(100n);
    mocks.planFarcasterSignupMock.mockReturnValue(buildReadyPlan());
    mocks.signTypedDataMock.mockResolvedValue(`0x${"33".repeat(65)}`);
    mocks.sendTransactionMock
      .mockResolvedValueOnce(REGISTER_TX_HASH)
      .mockResolvedValueOnce(ADD_KEY_TX_HASH);
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
