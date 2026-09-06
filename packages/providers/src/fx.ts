import { AppError, PAR_RATE, config, type Network, type Token } from "@gateway/core";
import type { AxiosInstance } from "axios";
import { httpClient } from "./http.js";

export interface Quote {
  rate: string;
  fiatAmount?: string;
  lockedAt: string;
  expiresAt: string;
}

export interface FxProvider {
  quote(token: Token, network: Network, cryptoAmount: string): Promise<Quote>;
}

function buildQuote(rate: string, fiatAmount?: string, ttl = config().FX_QUOTE_TTL_SECONDS): Quote {
  const now = new Date();
  return {
    rate,
    ...(fiatAmount ? { fiatAmount } : {}),
    lockedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl * 1000).toISOString()
  };
}

function normalizedAmount(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value) || !/[1-9]/.test(value)) {
    throw new AppError("Quote amount must be positive", 400, "invalid_amount");
  }
  const [whole = "0", fraction = ""] = value.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

export class LiveFxProvider implements FxProvider {
  constructor(
    private readonly url = config().FX_URL,
    private readonly http: AxiosInstance = httpClient({ timeout: 10_000 })
  ) {}

  async quote(token: Token, _network: Network, _cryptoAmount: string): Promise<Quote> {
    if (token === "cNGN") return buildQuote(PAR_RATE);
    if (!this.url) throw new AppError("FX_URL is not configured", 500, "fx_unconfigured");

    const { status, data: body } = await this.http.get<{
      rate?: number | string;
      fiatAmount?: number | string;
      expiresInSeconds?: number;
    }>(this.url, {
      // Fiam returns the token's NGN unit rate across supported chains. Always
      // request one unit on the canonical Ethereum route; the conversion layer
      // applies that rate to the payment amount using chain-specific decimals.
      params: { token, network: "ethereum", cryptoAmount: "1" }
    });
    if (status >= 400) {
      throw new AppError(`Rate feed returned ${status}`, 502, "fx_unavailable");
    }
    const rate = Number(body?.rate);
    const fiatAmount = body?.fiatAmount === undefined ? undefined : String(body.fiatAmount);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new AppError("Rate feed returned no usable rate", 502, "fx_unavailable");
    }
    const ttl =
      Number.isInteger(body?.expiresInSeconds) && Number(body.expiresInSeconds) > 0
        ? Number(body.expiresInSeconds)
        : config().FX_QUOTE_TTL_SECONDS;
    return buildQuote(rate.toFixed(8), fiatAmount, ttl);
  }
}

export class CachingFxProvider implements FxProvider {
  private readonly cache = new Map<string, Quote>();
  private readonly pending = new Map<string, Promise<Quote>>();

  constructor(private readonly inner: FxProvider) {}

  async quote(token: Token, network: Network, cryptoAmount: string): Promise<Quote> {
    const key = token;
    const cached = this.cache.get(key);
    if (cached && new Date(cached.expiresAt).getTime() > Date.now()) return cached;

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const request = this.inner
      .quote(token, network, cryptoAmount)
      .then((fresh) => {
        this.cache.set(key, fresh);
        return fresh;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}

export function createFxProvider(): FxProvider {
  return new CachingFxProvider(new LiveFxProvider());
}
