import { beforeAll, describe, expect, it } from "vitest";
import { deriveDepositAddress, derivationPath, resetDerivationCache } from "./addresses.js";

beforeAll(() => {
  process.env.WALLET_MNEMONIC = "test test test test test test test test test test test junk";
  resetDerivationCache();
});

describe("deriveDepositAddress", () => {
  it("is deterministic for a given index", () => {
    expect(deriveDepositAddress(0)).toBe(deriveDepositAddress(0));
  });

  it("gives every invoice a distinct address", () => {
    const addresses = new Set(Array.from({ length: 200 }, (_, i) => deriveDepositAddress(i)));
    expect(addresses.size).toBe(200);
  });

  it("produces checksummed addresses", () => {
    const address = deriveDepositAddress(7);
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(address).not.toBe(address.toLowerCase());
  });

  it("rejects an invalid index", () => {
    expect(() => deriveDepositAddress(-1)).toThrow();
    expect(() => deriveDepositAddress(1.5)).toThrow();
  });

  it("reports the derivation path used", () => {
    expect(derivationPath(3)).toBe("m/44'/60'/0'/0/3");
  });
});
