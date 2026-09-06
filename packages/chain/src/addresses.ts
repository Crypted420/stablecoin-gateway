import { HDNodeWallet, Mnemonic, getAddress } from "ethers";
import { AppError, config } from "@gateway/core";

const BASE_PATH = "m/44'/60'/0'/0";

let root: HDNodeWallet | null = null;

function rootNode(): HDNodeWallet {
  if (!root) {
    const phrase = config().WALLET_MNEMONIC.trim();
    if (!phrase) {
      throw new AppError("WALLET_MNEMONIC is not configured", 503, "wallet_mnemonic_unconfigured");
    }
    root = HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(phrase), BASE_PATH);
  }
  return root;
}

export function deriveDepositAddress(index: number): string {
  return getAddress(deriveDepositWallet(index).address);
}

export function deriveDepositWallet(index: number): HDNodeWallet {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Derivation index must be a non-negative integer, received ${index}`);
  }
  return rootNode().deriveChild(index);
}

export function derivationPath(index: number): string {
  return `${BASE_PATH}/${index}`;
}

export function resetDerivationCache(): void {
  root = null;
}
