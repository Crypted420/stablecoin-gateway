import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isAddress,
  keccak256,
  type HDNodeWallet,
  type TransactionRequest
} from "ethers";
import {
  AppError,
  chainProviderUrls,
  config,
  type Network,
  type Token
} from "@gateway/core";
import { deriveDepositWallet } from "./addresses.js";
import { tokenAddress } from "./networks.js";

const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address recipient, uint256 amount) returns (bool)"
];
const FALLBACK_TRANSFER_GAS = 100_000n;

export interface SweepWalletInput {
  network: Network;
  tokenSymbol: Token;
  depositAddress: string;
  derivationIndex: number;
  treasuryAddress: string;
}

export interface SweepInspection {
  tokenBalanceRaw: string;
  nativeBalanceRaw: string;
  requiredGasRaw: string;
  gasLimitRaw: string;
  feePerGasRaw: string;
}

export interface PreparedChainTransaction {
  hash: string;
  rawTransaction: string;
  amountRaw: string;
}

export function gasBudget(gasLimit: bigint, feePerGas: bigint, bufferBps: number): bigint {
  return (gasLimit * feePerGas * BigInt(bufferBps) + 9_999n) / 10_000n;
}

export class EvmWalletSweeper {
  private readonly providers = new Map<Network, JsonRpcProvider>();

  async inspect(input: SweepWalletInput): Promise<SweepInspection> {
    this.assertInput(input);
    const provider = await this.provider(input.network);
    const address = getAddress(input.depositAddress);
    const treasury = getAddress(input.treasuryAddress);
    const contractAddress = tokenAddress(input.network, input.tokenSymbol);
    if (!contractAddress) {
      throw new AppError(
        `${input.tokenSymbol} is not configured on ${input.network}`,
        400,
        "unsupported_sweep_asset"
      );
    }
    const token = new Contract(contractAddress, ERC20_ABI, provider);
    const tokenBalance = (await token.getFunction("balanceOf")(address)) as bigint;
    const nativeBalance = await provider.getBalance(address);
    if (tokenBalance === 0n) {
      return {
        tokenBalanceRaw: "0",
        nativeBalanceRaw: nativeBalance.toString(),
        requiredGasRaw: "0",
        gasLimitRaw: "0",
        feePerGasRaw: "0"
      };
    }

    const data = token.interface.encodeFunctionData("transfer", [treasury, tokenBalance]);
    const gasLimit = await provider
      .estimateGas({ from: address, to: contractAddress, data })
      .catch(() => FALLBACK_TRANSFER_GAS);
    const fee = await this.feeFields(provider);
    const requiredGas = gasBudget(gasLimit, fee.ceiling, config().SWEEP_GAS_BUFFER_BPS);
    return {
      tokenBalanceRaw: tokenBalance.toString(),
      nativeBalanceRaw: nativeBalance.toString(),
      requiredGasRaw: requiredGas.toString(),
      gasLimitRaw: gasLimit.toString(),
      feePerGasRaw: fee.ceiling.toString()
    };
  }

  async prepareFunding(
    input: SweepWalletInput,
    amountRaw: string
  ): Promise<PreparedChainTransaction> {
    this.assertInput(input);
    const privateKey = config().SWEEP_GAS_PRIVATE_KEY;
    if (!privateKey) {
      throw new AppError(
        "SWEEP_GAS_PRIVATE_KEY is not configured",
        503,
        "sweep_gas_wallet_unconfigured"
      );
    }
    const provider = await this.provider(input.network);
    const signer = new Wallet(privateKey, provider);
    const value = BigInt(amountRaw);
    if (value <= 0n) throw new AppError("Gas funding amount must be positive", 400, "invalid_gas_amount");
    const sponsorBalance = await provider.getBalance(signer.address);
    const fee = await this.feeFields(provider);
    const fundingFee = gasBudget(21_000n, fee.ceiling, config().SWEEP_GAS_BUFFER_BPS);
    if (sponsorBalance < value + fundingFee) {
      throw new AppError(
        `Gas wallet has insufficient native balance on ${input.network}`,
        409,
        "insufficient_gas_wallet_balance"
      );
    }
    return this.sign(provider, signer, {
      to: getAddress(input.depositAddress),
      value,
      gasLimit: 21_000n,
      ...fee.request
    }, value);
  }

  async prepareSweep(
    input: SweepWalletInput,
    inspection: SweepInspection
  ): Promise<PreparedChainTransaction> {
    this.assertInput(input);
    const provider = await this.provider(input.network);
    const derived = deriveDepositWallet(input.derivationIndex).connect(provider);
    if (getAddress(derived.address) !== getAddress(input.depositAddress)) {
      throw new AppError(
        "The derivation index does not control this deposit address",
        409,
        "deposit_key_mismatch"
      );
    }
    const contractAddress = tokenAddress(input.network, input.tokenSymbol);
    if (!contractAddress) {
      throw new AppError("Unsupported sweep asset", 400, "unsupported_sweep_asset");
    }
    const amount = BigInt(inspection.tokenBalanceRaw);
    if (amount <= 0n) throw new AppError("Deposit wallet has no token balance", 409, "empty_deposit_wallet");
    if (BigInt(inspection.nativeBalanceRaw) < BigInt(inspection.requiredGasRaw)) {
      throw new AppError("Deposit wallet still needs native gas", 409, "deposit_wallet_needs_gas");
    }
    const token = new Contract(contractAddress, ERC20_ABI, provider);
    const data = token.interface.encodeFunctionData("transfer", [getAddress(input.treasuryAddress), amount]);
    const fee = await this.feeFields(provider);
    return this.sign(provider, derived, {
      to: contractAddress,
      data,
      value: 0n,
      gasLimit: BigInt(inspection.gasLimitRaw) || FALLBACK_TRANSFER_GAS,
      ...fee.request
    }, amount);
  }

  async broadcast(
    network: Network,
    transaction: PreparedChainTransaction
  ): Promise<string> {
    const provider = await this.provider(network);
    const existing = await provider.getTransactionReceipt(transaction.hash);
    if (existing) {
      if (existing.status !== 1) throw new Error(`Transaction ${transaction.hash} reverted`);
      return transaction.hash;
    }
    try {
      await provider.broadcastTransaction(transaction.rawTransaction);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/already known|known transaction|nonce too low/i.test(message)) throw error;
    }
    const receipt = await provider.waitForTransaction(
      transaction.hash,
      config().SWEEP_CONFIRMATIONS,
      180_000
    );
    if (!receipt) throw new Error(`Timed out waiting for ${transaction.hash}`);
    if (receipt.status !== 1) throw new Error(`Transaction ${transaction.hash} reverted`);
    return transaction.hash;
  }

  async close(): Promise<void> {
    for (const provider of this.providers.values()) await provider.destroy();
    this.providers.clear();
  }

  private async provider(network: Network): Promise<JsonRpcProvider> {
    const existing = this.providers.get(network);
    if (existing) {
      try {
        await existing.getBlockNumber();
        return existing;
      } catch {
        this.providers.delete(network);
        existing.destroy();
      }
    }
    const urls = chainProviderUrls(network);
    if (urls.length === 0) {
      throw new AppError(`No RPC URL is configured for ${network}`, 503, "chain_unconfigured");
    }
    const chainId = network === "polygon" ? 137 : 56;
    let lastError: unknown = null;
    for (const url of urls) {
      const provider = new JsonRpcProvider(url, chainId, { staticNetwork: true });
      try {
        await provider.getBlockNumber();
        this.providers.set(network, provider);
        return provider;
      } catch (error) {
        lastError = error;
        provider.destroy();
      }
    }
    throw new AppError(
      `No RPC provider is currently available for ${network}: ${String(
        (lastError as { message?: string } | null)?.message ?? lastError ?? "unknown error"
      )}`,
      503,
      "chain_unavailable"
    );
  }

  private assertInput(input: SweepWalletInput): void {
    if (!isAddress(input.depositAddress) || !isAddress(input.treasuryAddress)) {
      throw new AppError("Deposit and treasury addresses must be valid EVM addresses", 400, "invalid_address");
    }
  }

  private async feeFields(provider: JsonRpcProvider): Promise<{
    ceiling: bigint;
    request: Pick<TransactionRequest, "type" | "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">;
  }> {
    const data = await provider.getFeeData();
    if (data.maxFeePerGas !== null && data.maxPriorityFeePerGas !== null) {
      return {
        ceiling: data.maxFeePerGas,
        request: {
          type: 2,
          maxFeePerGas: data.maxFeePerGas,
          maxPriorityFeePerGas: data.maxPriorityFeePerGas
        }
      };
    }
    const gasPrice = data.gasPrice;
    if (gasPrice === null) throw new Error("RPC provider did not return gas pricing");
    return { ceiling: gasPrice, request: { gasPrice } };
  }

  private async sign(
    provider: JsonRpcProvider,
    signer: Wallet | HDNodeWallet,
    request: TransactionRequest,
    amount: bigint
  ): Promise<PreparedChainTransaction> {
    const [nonce, network] = await Promise.all([
      provider.getTransactionCount(signer.address, "pending"),
      provider.getNetwork()
    ]);
    const rawTransaction = await signer.signTransaction({
      ...request,
      nonce,
      chainId: network.chainId
    });
    return { hash: keccak256(rawTransaction), rawTransaction, amountRaw: amount.toString() };
  }
}
