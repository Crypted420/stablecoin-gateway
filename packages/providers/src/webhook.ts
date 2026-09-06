import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { AxiosInstance } from "axios";
import { AppError, config, type DomainEvent } from "@gateway/core";
import { httpClient } from "./http.js";

type HostResolver = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
const defaultResolver: HostResolver = (hostname) => lookup(hostname, { all: true, verbatim: true });

function publicIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  return !(a === 198 && (b === 18 || b === 19 || b === 51)) && !(a === 203 && b === 0);
}

export function isPublicWebhookAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return publicIpv4(address);
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return publicIpv4(normalized.slice(7));
  return !(
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

export async function assertSafeWebhookUrl(url: string, resolver: HostResolver = defaultResolver): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new AppError("Webhook URLs must use public HTTPS endpoints without credentials", 400, "unsafe_webhook_url");
  }
  const directFamily = isIP(parsed.hostname);
  const addresses = directFamily
    ? [{ address: parsed.hostname, family: directFamily }]
    : await resolver(parsed.hostname);
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicWebhookAddress(address))) {
    throw new AppError("Webhook URLs cannot resolve to private or reserved addresses", 400, "unsafe_webhook_url");
  }
}

export class WebhookDispatcher {
  constructor(
    private readonly signingSecret = config().WEBHOOK_SIGNING_SECRET,
    private readonly http: AxiosInstance = httpClient({ timeout: 10_000 }),
    private readonly resolver: HostResolver = defaultResolver
  ) {}

  async deliver(url: string, event: DomainEvent): Promise<number> {
    if (!this.signingSecret || ["change-me-in-production", "replace-with-a-long-random-secret"].includes(this.signingSecret)) {
      throw new AppError(
        "WEBHOOK_SIGNING_SECRET must be configured before merchant webhooks can be delivered",
        503,
        "webhook_signing_unconfigured"
      );
    }
    await assertSafeWebhookUrl(url, this.resolver);
    const body = JSON.stringify(event);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = createHmac("sha256", this.signingSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    const { status, data } = await this.http.post(url, body, {
      maxRedirects: 0,
      headers: {
        "Content-Type": "application/json",
        "X-Gateway-Event-Id": event.eventId,
        "X-Gateway-Timestamp": timestamp,
        "X-Gateway-Signature": `sha256=${signature}`
      }
    });
    if (status < 200 || status >= 300) {
      throw new AppError(`Webhook returned HTTP ${status}: ${String(data).slice(0, 200)}`, 502, "webhook_rejected");
    }
    return status;
  }
}
