import { describe, expect, it } from "vitest";
import { Decimal, convertToNgn, decimalToTokenRaw, ngn, tokenAmountToDecimal } from "./money.js";

describe("Decimal", () => {
  it("round-trips a decimal string without loss", () => {
    expect(Decimal.fromString("1234.56", 2).toString()).toBe("1234.56");
    expect(Decimal.fromString("0.000001", 6).toString()).toBe("0.000001");
  });

  it("rejects more precision than the scale allows", () => {
    expect(() => Decimal.fromString("1.234", 2)).toThrow();
  });

  it("adds without the error binary floating point would introduce", () => {
    const total = ngn("0.10").add(ngn("0.20"));
    expect(total.toString()).toBe("0.30");
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("sums a long run of small amounts exactly", () => {
    let total = ngn("0.00");
    for (let i = 0; i < 1000; i += 1) total = total.add(ngn("0.01"));
    expect(total.toString()).toBe("10.00");
  });

  it("rounds half up when reducing scale", () => {
    expect(Decimal.fromString("1.005", 3).rescale(2).toString()).toBe("1.01");
    expect(Decimal.fromString("1.004", 3).rescale(2).toString()).toBe("1.00");
    expect(Decimal.fromString("-1.005", 3).rescale(2).toString()).toBe("-1.01");
  });
});

describe("token amounts", () => {
  it("reads a raw on-chain amount at the token's own precision", () => {
    expect(tokenAmountToDecimal("1500000", "polygon", "USDT").toString()).toBe("1.500000");
    expect(decimalToTokenRaw("1.5", "polygon", "USDC")).toBe("1500000");
  });

  it("uses 18 decimals for BSC USDT and USDC", () => {
    expect(tokenAmountToDecimal("1000000000000000000", "bsc", "USDT").toString()).toBe(
      "1.000000000000000000"
    );
    expect(decimalToTokenRaw("1.5", "bsc", "USDC")).toBe("1500000000000000000");
  });
});

describe("convertToNgn", () => {
  it("applies a locked rate to a dollar-pegged token", () => {
    expect(convertToNgn("100000000", "polygon", "USDT", "1580.00000000")).toBe("158000.00");
    expect(convertToNgn("100000000000000000000", "bsc", "USDT", "1580.00000000")).toBe("158000.00");
  });

  it("redeems cNGN at par", () => {
    expect(convertToNgn("250000000", "bsc", "cNGN", "1.00000000")).toBe("250.00");
  });

  it("rounds a half-kobo up, once, at the end of the calculation", () => {
    expect(convertToNgn("250", "polygon", "USDT", "1580.00000000")).toBe("0.40");
  });

  it("rounds an amount below half a kobo down to zero", () => {
    expect(convertToNgn("1", "polygon", "USDT", "1580.00000000")).toBe("0.00");
  });

  it("is exact across a large amount", () => {
    expect(convertToNgn("12345678901", "polygon", "USDC", "1583.45000000")).toBe("19548765.26");
  });
});

describe("token amounts stored at ledger scale", () => {
  it("accepts an amount read back from a NUMERIC(24,8) column", () => {
    expect(decimalToTokenRaw("25.00000000", "polygon", "USDT")).toBe("25000000");
    expect(decimalToTokenRaw("25.00000000", "polygon", "USDC")).toBe("25000000");
    expect(decimalToTokenRaw("25.00000000", "bsc", "USDT")).toBe("25000000000000000000");
  });

  it("applies each token's own scale", () => {
    expect(decimalToTokenRaw("1.00000000", "bsc", "cNGN")).toBe("1000000");
  });

  it("rounds half up when the amount is finer than the token allows", () => {
    expect(decimalToTokenRaw("1.0000005", "polygon", "USDT")).toBe("1000001");
  });
});
