import {
  EvmWalletSweeper,
  type PreparedChainTransaction,
  type SweepInspection,
  type SweepWalletInput
} from "@gateway/chain";
import { AppError, config, createLogger, metrics, type WalletSweep } from "@gateway/core";
import { sweeps } from "@gateway/db";

const log = createLogger("wallet-sweep");

export class WalletSweepService {
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly chain = new EvmWalletSweeper()) {}

  async fund(paymentId: string): Promise<WalletSweep> {
    return this.serialized(() => this.fundUnlocked(paymentId));
  }

  private async fundUnlocked(paymentId: string): Promise<WalletSweep> {
    const job = await this.job(paymentId);
    if (["completed", "empty"].includes(job.status)) return job;
    let transactionId: string | null = null;
    try {
      await sweeps.setStatus(job.id, "funding");
      let inspection = await this.inspect(job);
      if (BigInt(inspection.tokenBalanceRaw) === 0n) {
        const pendingSweep = await sweeps.openTransaction(job.id, "sweep");
        if (pendingSweep) {
          await sweeps.setTransactionStatus(pendingSweep.id, "submitted");
          await this.chain.broadcast(job.network, this.prepared(pendingSweep));
          await sweeps.setTransactionStatus(pendingSweep.id, "confirmed");
          return sweeps.setStatus(job.id, "completed");
        }
        return sweeps.setStatus(job.id, "empty");
      }

      let transaction = await sweeps.openTransaction(job.id, "funding");
      if (transaction) {
        transactionId = transaction.id;
        await sweeps.setTransactionStatus(transaction.id, "submitted");
        await this.chain.broadcast(job.network, this.prepared(transaction));
        await sweeps.setTransactionStatus(transaction.id, "confirmed");
        inspection = await this.inspect(job);
      }
      const shortfall = BigInt(inspection.requiredGasRaw) - BigInt(inspection.nativeBalanceRaw);
      if (shortfall <= 0n) return sweeps.setStatus(job.id, "funded");

      const prepared = await this.chain.prepareFunding(this.input(job), shortfall.toString());
      transaction = await sweeps.savePreparedTransaction(job.id, "funding", prepared);
      transactionId = transaction.id;
      await sweeps.setTransactionStatus(transaction.id, "submitted");
      await this.chain.broadcast(job.network, this.prepared(transaction));
      await sweeps.setTransactionStatus(transaction.id, "confirmed");

      inspection = await this.inspect(job);
      if (BigInt(inspection.nativeBalanceRaw) < BigInt(inspection.requiredGasRaw)) {
        throw new AppError(
          "Gas funding confirmed but the deposit wallet still needs more native currency",
          409,
          "gas_top_up_required"
        );
      }
      metrics.increment("wallet_gas_funded_total", { network: job.network });
      log.info("deposit wallet funded", { paymentId, txHash: transaction.txHash });
      return sweeps.setStatus(job.id, "funded");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (transactionId) {
        // A submitted transaction remains resumable. Do not discard its signed payload on timeout.
        log.warn("gas funding has not completed", { paymentId, error: message });
      }
      await sweeps.setStatus(job.id, "failed", message);
      throw error;
    }
  }

  async sweep(paymentId: string): Promise<WalletSweep> {
    return this.serialized(() => this.sweepUnlocked(paymentId));
  }

  private async sweepUnlocked(paymentId: string): Promise<WalletSweep> {
    let job = await this.fundUnlocked(paymentId);
    if (["completed", "empty"].includes(job.status)) return job;
    let transactionId: string | null = null;
    try {
      let inspection = await this.inspect(job);
      if (BigInt(inspection.tokenBalanceRaw) === 0n) {
        return sweeps.setStatus(job.id, "empty");
      }
      if (BigInt(inspection.nativeBalanceRaw) < BigInt(inspection.requiredGasRaw)) {
        job = await this.fundUnlocked(paymentId);
        inspection = await this.inspect(job);
      }

      await sweeps.setStatus(job.id, "sweeping");
      let transaction = await sweeps.openTransaction(job.id, "sweep");
      if (!transaction) {
        const prepared = await this.chain.prepareSweep(this.input(job), inspection);
        transaction = await sweeps.savePreparedTransaction(job.id, "sweep", prepared);
      }
      transactionId = transaction.id;
      await sweeps.setTransactionStatus(transaction.id, "submitted");
      await this.chain.broadcast(job.network, this.prepared(transaction));
      await sweeps.setTransactionStatus(transaction.id, "confirmed");

      const after = await this.inspect(job);
      if (BigInt(after.tokenBalanceRaw) !== 0n) {
        throw new Error("A token balance remains after the sweep; run the sweep again");
      }
      metrics.increment("wallet_sweeps_completed_total", {
        network: job.network,
        token: job.tokenSymbol
      });
      log.info("deposit wallet swept", {
        paymentId,
        treasury: job.treasuryAddress,
        txHash: transaction.txHash
      });
      return sweeps.setStatus(job.id, "completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (transactionId) log.warn("token sweep has not completed", { paymentId, error: message });
      await sweeps.setStatus(job.id, "failed", message);
      throw error;
    }
  }

  async runAll(action: "fund" | "sweep"): Promise<{
    processed: number;
    succeeded: number;
    failed: Array<{ paymentId: string; error: string }>;
  }> {
    const paymentIds = await sweeps.eligiblePaymentIds(config().SWEEP_MAX_BATCH);
    const failed: Array<{ paymentId: string; error: string }> = [];
    let succeeded = 0;
    for (const paymentId of paymentIds) {
      try {
        if (action === "fund") await this.fund(paymentId);
        else await this.sweep(paymentId);
        succeeded += 1;
      } catch (error) {
        failed.push({ paymentId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { processed: paymentIds.length, succeeded, failed };
  }

  async close(): Promise<void> {
    await this.operationQueue;
    await this.chain.close();
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.operationQueue.then(operation, operation);
    this.operationQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async job(paymentId: string): Promise<WalletSweep> {
    if (!config().TREASURY_ADDRESS) {
      throw new AppError("TREASURY_ADDRESS is not configured", 503, "treasury_unconfigured");
    }
    const job = await sweeps.ensureJob(paymentId, config().TREASURY_ADDRESS);
    if (!job) {
      throw new AppError(
        "Only confirmed payments can be funded or swept",
        404,
        "confirmed_payment_not_found"
      );
    }
    return job;
  }

  private input(job: WalletSweep): SweepWalletInput {
    return {
      network: job.network,
      tokenSymbol: job.tokenSymbol,
      depositAddress: job.depositAddress,
      derivationIndex: job.derivationIndex,
      treasuryAddress: job.treasuryAddress
    };
  }

  private async inspect(job: WalletSweep): Promise<SweepInspection> {
    const inspection = await this.chain.inspect(this.input(job));
    await sweeps.recordInspection(job.id, inspection);
    return inspection;
  }

  private prepared(transaction: {
    txHash: string;
    rawTransaction: string;
    amountRaw: string;
  }): PreparedChainTransaction {
    return {
      hash: transaction.txHash,
      rawTransaction: transaction.rawTransaction,
      amountRaw: transaction.amountRaw
    };
  }
}
