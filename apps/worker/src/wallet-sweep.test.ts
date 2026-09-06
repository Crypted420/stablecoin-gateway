import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfig, type WalletSweep } from "@gateway/core";
import type { EvmWalletSweeper } from "@gateway/chain";

const mocks = vi.hoisted(() => ({
  ensureJob: vi.fn(),
  setStatus: vi.fn(),
  recordInspection: vi.fn(),
  openTransaction: vi.fn(),
  savePreparedTransaction: vi.fn(),
  setTransactionStatus: vi.fn(),
  eligiblePaymentIds: vi.fn()
}));

vi.mock("@gateway/db", () => ({ sweeps: mocks }));

import { WalletSweepService } from "./services/wallet-sweep.js";

const originalTreasury = process.env.TREASURY_ADDRESS;
const treasury = "0x0000000000000000000000000000000000000001";
const job: WalletSweep = {
  id: "11111111-1111-4111-8111-111111111111",
  paymentId: "22222222-2222-4222-8222-222222222222",
  invoiceId: "33333333-3333-4333-8333-333333333333",
  network: "polygon",
  tokenSymbol: "USDC",
  depositAddress: "0x0000000000000000000000000000000000000002",
  derivationIndex: 7,
  treasuryAddress: treasury,
  tokenBalanceRaw: null,
  nativeBalanceRaw: null,
  requiredGasRaw: null,
  status: "pending",
  attempts: 0,
  lastError: null,
  completedAt: null,
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z"
};

const inspection = (token: string, native: string, required: string) => ({
  tokenBalanceRaw: token,
  nativeBalanceRaw: native,
  requiredGasRaw: required,
  gasLimitRaw: "100000",
  feePerGasRaw: "30"
});

function fakeChain() {
  return {
    inspect: vi.fn(),
    prepareFunding: vi.fn(),
    prepareSweep: vi.fn(),
    broadcast: vi.fn(),
    close: vi.fn()
  };
}

describe("WalletSweepService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TREASURY_ADDRESS = treasury;
    resetConfig();
    mocks.ensureJob.mockResolvedValue(job);
    mocks.setStatus.mockImplementation(async (_id, status, error = null) => ({
      ...job,
      status,
      lastError: error
    }));
    mocks.recordInspection.mockResolvedValue(job);
    mocks.openTransaction.mockResolvedValue(null);
    mocks.savePreparedTransaction.mockImplementation(async (sweepId, kind, transaction) => ({
      id: `${kind}-transaction`,
      sweepId,
      kind,
      txHash: transaction.hash,
      rawTransaction: transaction.rawTransaction,
      amountRaw: transaction.amountRaw,
      status: "prepared"
    }));
  });

  afterAll(() => {
    if (originalTreasury === undefined) delete process.env.TREASURY_ADDRESS;
    else process.env.TREASURY_ADDRESS = originalTreasury;
    resetConfig();
  });

  it("persists a signed gas transaction before broadcasting it", async () => {
    const chain = fakeChain();
    chain.inspect
      .mockResolvedValueOnce(inspection("1000000", "100", "1000"))
      .mockResolvedValueOnce(inspection("1000000", "1000", "1000"));
    chain.prepareFunding.mockResolvedValue({
      hash: "0xfunding",
      rawTransaction: "0xsigned-funding",
      amountRaw: "900"
    });
    chain.broadcast.mockResolvedValue("0xfunding");

    const result = await new WalletSweepService(chain as unknown as EvmWalletSweeper).fund(job.paymentId);

    expect(result.status).toBe("funded");
    expect(mocks.savePreparedTransaction).toHaveBeenCalledWith(
      job.id,
      "funding",
      expect.objectContaining({ hash: "0xfunding" })
    );
    expect(mocks.savePreparedTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      chain.broadcast.mock.invocationCallOrder[0]!
    );
    expect(chain.prepareFunding).toHaveBeenCalledWith(expect.anything(), "900");
  });

  it("funds when needed and then sweeps the complete token balance", async () => {
    const chain = fakeChain();
    chain.inspect
      .mockResolvedValueOnce(inspection("2500000", "1000", "1000"))
      .mockResolvedValueOnce(inspection("2500000", "1000", "1000"))
      .mockResolvedValueOnce(inspection("0", "100", "0"));
    chain.prepareSweep.mockResolvedValue({
      hash: "0xsweep",
      rawTransaction: "0xsigned-sweep",
      amountRaw: "2500000"
    });
    chain.broadcast.mockResolvedValue("0xsweep");

    const result = await new WalletSweepService(chain as unknown as EvmWalletSweeper).sweep(job.paymentId);

    expect(result.status).toBe("completed");
    expect(chain.prepareSweep).toHaveBeenCalledWith(
      expect.objectContaining({ treasuryAddress: treasury }),
      expect.objectContaining({ tokenBalanceRaw: "2500000" })
    );
    expect(mocks.savePreparedTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      chain.broadcast.mock.invocationCallOrder[0]!
    );
  });
});
