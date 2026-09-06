import type { Network, Token } from "@gateway/core";

export interface TransferObservation {
  network: Network;
  tokenSymbol: Token;
  txHash: string;
  logIndex: number;
  fromAddress: string;
  toAddress: string;
  amountRaw: string;
  blockNumber: number;
  blockHash: string | null;
}

export interface WatchTarget {
  address: string;
  network: Network;
  tokenSymbol: Token;
  invoiceId: string;
}

export interface ChainSource {
  start(onTransfer: (t: TransferObservation) => Promise<void>): Promise<void>;
  setTargets(targets: WatchTarget[]): void;
  confirmationsFor(network: Network, blockNumber: number): Promise<number>;
  isCanonical(network: Network, blockNumber: number, blockHash: string | null): Promise<boolean>;
  stop(): Promise<void>;
}
