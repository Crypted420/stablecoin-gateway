import {
  Contract,
  JsonRpcProvider,
  getAddress,
  id as keccakId,
  zeroPadValue,
  type ContractEventPayload,
  type EventLog
} from "ethers";
import { AppError, chainProviderUrls, config, createLogger, type Network, type Token } from "@gateway/core";
import { NETWORK_SPECS, tokenAddress } from "./networks.js";
import type { ChainSource, TransferObservation, WatchTarget } from "./source.js";

const ERC20_ABI = ["event Transfer(address indexed from, address indexed to, uint256 value)"];
const TRANSFER_TOPIC = keccakId("Transfer(address,address,uint256)");
const MIN_SCAN_RANGE = 5;

export class LiveChainSource implements ChainSource {
  private readonly log = createLogger("chain-listener");
  private readonly providers = new Map<Network, JsonRpcProvider[]>();
  private readonly cursors = new Map<Network, number>();
  private targets = new Map<string, WatchTarget>();
  private contracts: Contract[] = [];
  private scanTimer: NodeJS.Timeout | null = null;
  private scanning = false;
  private readonly ranges = new Map<Network, number>();
  private handler: ((t: TransferObservation) => Promise<void>) | null = null;

  constructor(private readonly networks: Network[]) {}

  setTargets(targets: WatchTarget[]): void {
    const next = new Map(
      targets.map((target) => [`${target.network}:${target.address.toLowerCase()}`, target] as const)
    );
    const networksWithNewTargets = new Set<Network>();
    for (const [key, target] of next) {
      if (!this.targets.has(key)) networksWithNewTargets.add(target.network);
    }
    this.targets = next;

    // A payer can transfer immediately after an invoice is created, before the
    // worker's next target refresh. Rewind only the affected network so the
    // recovery scan includes that short registration gap.
    for (const network of networksWithNewTargets) {
      const cursor = this.cursors.get(network);
      if (cursor !== undefined) {
        this.cursors.set(network, Math.max(0, cursor - config().CHAIN_TARGET_BACKFILL_BLOCKS));
      }
    }
  }

  async start(onTransfer: (t: TransferObservation) => Promise<void>): Promise<void> {
    this.handler = onTransfer;
    let listening = 0;
    const detectionMode = config().CHAIN_DETECTION_MODE;

    for (const network of this.networks) {
      const spec = NETWORK_SPECS[network];
      const urls = chainProviderUrls(network);
      if (urls.length === 0) {
        this.log.warn("no HTTP RPC URL configured, skipping network", { network });
        continue;
      }
      if (urls.length < 2) this.log.debug("network has one RPC provider", { network });

      const providers: JsonRpcProvider[] = [];
      for (const url of urls) {
        const provider = new JsonRpcProvider(url, spec.chainId, { staticNetwork: true });
        providers.push(provider);
        if (detectionMode === "rpc") await this.subscribe(network, provider);
      }
      this.providers.set(network, providers);

      const head = await this.firstSuccessful(providers, (provider) => provider.getBlockNumber());
      this.cursors.set(network, Math.max(0, head - config().CHAIN_BACKFILL_BLOCKS));
      listening += 1;
      this.log.debug("chain provider ready", {
        network,
        providers: providers.length,
        detectionMode,
        topic: TRANSFER_TOPIC
      });
    }

    if (listening === 0) {
      throw new AppError(
          "No RPC endpoint is configured. Confirmation and reorg checks require " +
          "POLYGON_RPC_URL or BSC_RPC_URL even when Alchemy webhooks detect transfers.",
        500,
        "chain_unconfigured"
      );
    }

    await this.scanAll();
    if (detectionMode === "rpc") {
      this.scanTimer = setInterval(() => void this.scanAll(), config().CHAIN_SCAN_INTERVAL_MS);
    } else {
      this.log.debug("Alchemy webhooks are primary; continuous log scanning is disabled");
    }
  }

  private async subscribe(network: Network, provider: JsonRpcProvider): Promise<void> {
    const spec = NETWORK_SPECS[network];
    for (const token of Object.keys(spec.tokens) as Token[]) {
      const address = tokenAddress(network, token);
      if (!address) continue;
      const contract = new Contract(address, ERC20_ABI, provider);
      this.contracts.push(contract);
      await contract.on(
        "Transfer",
        async (from: string, to: string, value: bigint, payload: ContractEventPayload) => {
          if (typeof to !== "string" || typeof from !== "string" || typeof value !== "bigint" || !payload?.log) {
            this.log.warn("malformed transfer event ignored", { network, token });
            return;
          }
          const target = this.targets.get(`${network}:${to.toLowerCase()}`);
          if (!target || target.tokenSymbol !== token) return;
          await this.emit({
            network,
            tokenSymbol: token,
            txHash: payload.log.transactionHash,
            logIndex: payload.log.index,
            fromAddress: from,
            toAddress: to,
            amountRaw: value.toString(),
            blockNumber: payload.log.blockNumber,
            blockHash: payload.log.blockHash ?? null
          });
        }
      );
    }
  }

  private async scanAll(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await Promise.all(
        this.networks.map((network) =>
          this.scanNetwork(network).catch((error) =>
            this.log.error("historical scan failed", { network, error: String(error) })
          )
        )
      );
    } finally {
      this.scanning = false;
    }
  }

  private async scanNetwork(network: Network): Promise<void> {
    const providers = this.providers.get(network) ?? [];
    if (providers.length === 0) return;
    let provider: JsonRpcProvider | null = null;
    let head = 0;
    for (const candidate of providers) {
      try {
        head = await candidate.getBlockNumber();
        provider = candidate;
        break;
      } catch {
        continue;
      }
    }
    if (!provider) throw new Error(`No ${network} provider is available for historical scanning`);
    const max = config().CHAIN_SCAN_RANGE_BLOCKS;
    let range = this.ranges.get(network) ?? max;
    let from = this.cursors.get(network) ?? Math.max(0, head - config().CHAIN_BACKFILL_BLOCKS);

    while (from <= head) {
      const to = Math.min(head, from + range - 1);
      try {
        for (const token of Object.keys(NETWORK_SPECS[network].tokens) as Token[]) {
          const destinations = [...this.targets.values()]
            .filter((target) => target.network === network && target.tokenSymbol === token)
            .map((target) => zeroPadValue(target.address, 32));
          if (destinations.length === 0) continue;
          const address = tokenAddress(network, token);
          if (!address) continue;
          const logs = await provider.getLogs({
            address,
            topics: [TRANSFER_TOPIC, null, destinations],
            fromBlock: from,
            toBlock: to
          });
          for (const log of logs) await this.emitLog(network, token, log as EventLog);
        }
      } catch (error) {
        const narrowed = narrowRange(range, rangeLimitFrom(error));
        if (narrowed === null) throw error;
        range = narrowed;
        this.ranges.set(network, range);
        this.log.warn("provider limits the log range, narrowing the scan", { network, range });
        continue;
      }

      from = to + 1;
      this.cursors.set(network, from);

      if (range < max) {
        range = widenRange(range, max);
        this.ranges.set(network, range);
      }
    }
  }

  private async emitLog(network: Network, token: Token, log: EventLog): Promise<void> {
    const fromTopic = log.topics[1];
    const toTopic = log.topics[2];
    if (!fromTopic || !toTopic) return;
    const fromAddress = getAddress(`0x${fromTopic.slice(-40)}`);
    const toAddress = getAddress(`0x${toTopic.slice(-40)}`);
    const target = this.targets.get(`${network}:${toAddress.toLowerCase()}`);
    if (!target || target.tokenSymbol !== token) return;
    await this.emit({
      network,
      tokenSymbol: token,
      txHash: log.transactionHash,
      logIndex: log.index,
      fromAddress,
      toAddress,
      amountRaw: BigInt(log.data).toString(),
      blockNumber: log.blockNumber,
      blockHash: log.blockHash ?? null
    });
  }

  private async emit(observation: TransferObservation): Promise<void> {
    if (!this.handler) return;
    await this.handler(observation).catch((error) =>
      this.log.error("could not persist transfer observation", {
        network: observation.network,
        txHash: observation.txHash,
        error: String(error)
      })
    );
  }

  async confirmationsFor(network: Network, blockNumber: number): Promise<number> {
    const providers = this.providers.get(network) ?? [];
    if (providers.length === 0) return 0;
    const results = await Promise.allSettled(providers.map((provider) => provider.getBlockNumber()));
    const heads = results
      .filter((result): result is PromiseFulfilledResult<number> => result.status === "fulfilled")
      .map((result) => result.value)
      .sort((a, b) => a - b);
    if (heads.length === 0) return 0;
    const head = heads[Math.floor(heads.length / 2)]!;
    return Math.max(0, head - blockNumber + 1);
  }

  async isCanonical(network: Network, blockNumber: number, blockHash: string | null): Promise<boolean> {
    if (!blockHash) return true;
    const providers = this.providers.get(network) ?? [];
    const results = await Promise.allSettled(providers.map((provider) => provider.getBlock(blockNumber)));
    const hashes = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => (result as PromiseFulfilledResult<Awaited<ReturnType<JsonRpcProvider["getBlock"]>>>).value?.hash?.toLowerCase())
      .filter((hash): hash is string => Boolean(hash));
    if (hashes.length === 0) return false;
    const matches = hashes.filter((hash) => hash === blockHash.toLowerCase()).length;
    return matches > hashes.length / 2;
  }

  private async firstSuccessful<T>(
    providers: JsonRpcProvider[],
    operation: (provider: JsonRpcProvider) => Promise<T>
  ): Promise<T> {
    return Promise.any(providers.map(operation));
  }

  async stop(): Promise<void> {
    if (this.scanTimer) clearInterval(this.scanTimer);
    for (const contract of this.contracts) await contract.removeAllListeners();
    for (const providers of this.providers.values()) {
      for (const provider of providers) await provider.destroy();
    }
    this.providers.clear();
    this.contracts = [];
  }
}

export function rangeLimitFrom(error: unknown): number | null {
  const message = JSON.stringify(error instanceof Error ? error.message : error);
  if (!/block range|range should work|limited to|too many blocks|exceeds|query returned more than/i.test(message)) {
    return null;
  }
  const stated = /up to a (\d+) block range/i.exec(message);
  return stated?.[1] ? Number(stated[1]) : Number.MAX_SAFE_INTEGER;
}

export function narrowRange(current: number, allowed: number | null): number | null {
  if (allowed === null) return null;
  if (current <= MIN_SCAN_RANGE) return null;
  return Math.max(MIN_SCAN_RANGE, Math.min(allowed, Math.floor(current / 2)));
}

export function widenRange(current: number, max: number): number {
  return Math.min(max, current + Math.ceil(current / 4));
}
