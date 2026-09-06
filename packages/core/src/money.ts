import { AppError } from "./errors.js";
import type { Network, Token } from "./types.js";

export const TOKEN_DECIMALS: Record<Network, Record<Token, number>> = {
  polygon: { USDT: 6, USDC: 6, cNGN: 6 },
  bsc: { USDT: 18, USDC: 18, cNGN: 6 }
};

const NGN_SCALE = 2n;
export const LEDGER_SCALE = 8;

function pow10(n: number): bigint {
  return 10n ** BigInt(n);
}

export class Decimal {
  private constructor(
    readonly units: bigint,
    readonly scale: number
  ) {}

  static fromString(value: string, scale: number): Decimal {
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      throw new AppError(`Not a decimal: ${value}`, 400, "invalid_amount");
    }
    const negative = value.startsWith("-");
    const [whole = "0", fraction = ""] = value.replace("-", "").split(".");
    if (fraction.length > scale) {
      throw new AppError(`Value ${value} exceeds scale ${scale}`, 400, "invalid_amount");
    }
    const padded = fraction.padEnd(scale, "0");
    const units = BigInt(whole + padded);
    return new Decimal(negative ? -units : units, scale);
  }

  static fromUnits(units: bigint, scale: number): Decimal {
    return new Decimal(units, scale);
  }

  static zero(scale: number): Decimal {
    return new Decimal(0n, scale);
  }

  toString(): string {
    const negative = this.units < 0n;
    const abs = negative ? -this.units : this.units;
    const divisor = pow10(this.scale);
    const whole = abs / divisor;
    const fraction = (abs % divisor).toString().padStart(this.scale, "0");
    const body = this.scale === 0 ? `${whole}` : `${whole}.${fraction}`;
    return negative ? `-${body}` : body;
  }

  add(other: Decimal): Decimal {
    this.assertScale(other);
    return new Decimal(this.units + other.units, this.scale);
  }

  subtract(other: Decimal): Decimal {
    this.assertScale(other);
    return new Decimal(this.units - other.units, this.scale);
  }

  compare(other: Decimal): number {
    this.assertScale(other);
    if (this.units === other.units) return 0;
    return this.units < other.units ? -1 : 1;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  rescale(scale: number): Decimal {
    if (scale === this.scale) return this;
    if (scale > this.scale) {
      return new Decimal(this.units * pow10(scale - this.scale), scale);
    }
    return new Decimal(divideHalfUp(this.units, pow10(this.scale - scale)), scale);
  }

  private assertScale(other: Decimal): void {
    if (other.scale !== this.scale) {
      throw new AppError("Cannot combine decimals of different scale", 500, "scale_mismatch");
    }
  }
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

export function tokenDecimals(network: Network, token: Token): number {
  return TOKEN_DECIMALS[network][token];
}

export function tokenAmountToDecimal(amountRaw: string, network: Network, token: Token): Decimal {
  return Decimal.fromUnits(BigInt(amountRaw), tokenDecimals(network, token));
}

export function decimalToTokenRaw(amount: string, network: Network, token: Token): string {
  return Decimal.fromString(amount, LEDGER_SCALE).rescale(tokenDecimals(network, token)).units.toString();
}

export function convertToNgn(amountRaw: string, network: Network, token: Token, ngnPerUnit: string): string {
  const rate = Decimal.fromString(ngnPerUnit, 8);
  const tokenUnits = BigInt(amountRaw);
  const tokenScale = pow10(tokenDecimals(network, token));
  const rateScale = pow10(8);
  const ngnScale = pow10(Number(NGN_SCALE));

  const numerator = tokenUnits * rate.units * ngnScale;
  const denominator = tokenScale * rateScale;
  return Decimal.fromUnits(divideHalfUp(numerator, denominator), Number(NGN_SCALE)).toString();
}

export function ngn(value: string): Decimal {
  return Decimal.fromString(value, Number(NGN_SCALE));
}

export const PAR_RATE = "1.00000000";
