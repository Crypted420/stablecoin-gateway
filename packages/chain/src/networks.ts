import type { Network, Token } from "@gateway/core";

export interface NetworkSpec {
  network: Network;
  chainId: number;
  label: string;
  blockSeconds: number;
  tokens: Partial<Record<Token, string>>;
}

export const NETWORK_SPECS: Record<Network, NetworkSpec> = {
  polygon: {
    network: "polygon",
    chainId: 137,
    label: "Polygon",
    blockSeconds: 2,
    tokens: {
      USDT: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      USDC: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
      cNGN: "0x52828daa48C1a9A06F37500882b42daf0bE04C3B"
    }
  },
  bsc: {
    network: "bsc",
    chainId: 56,
    label: "BNB Smart Chain",
    blockSeconds: 3,
    tokens: {
      USDT: "0x55d398326f99059fF775485246999027B3197955",
      USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
      cNGN: "0xa8AEA66B361a8d53e8865c62D142167Af28Af058"
    }
  }
};

export function tokenAddress(network: Network, token: Token): string | undefined {
  return NETWORK_SPECS[network].tokens[token];
}

export function isSupportedAsset(network: Network, token: Token): boolean {
  return Boolean(tokenAddress(network, token));
}

export function supportedAssets(): Array<{ network: Network; tokenSymbol: Token }> {
  return (Object.keys(NETWORK_SPECS) as Network[]).flatMap((network) =>
    (Object.keys(NETWORK_SPECS[network].tokens) as Token[]).map((tokenSymbol) => ({ network, tokenSymbol }))
  );
}
