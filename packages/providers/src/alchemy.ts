import { AppError, alchemyWebhookId, config, type Network } from "@gateway/core";
import type { AxiosInstance } from "axios";
import { httpClient } from "./http.js";

const ADDRESS_BATCH_SIZE = 500;

export interface ChainAddressRegistrar {
  addAddresses(network: Network, addresses: string[]): Promise<void>;
}

export class AlchemyNotifyClient implements ChainAddressRegistrar {
  constructor(
    private readonly authToken = config().ALCHEMY_NOTIFY_AUTH_TOKEN,
    private readonly webhookIds: Record<Network, string> = {
      polygon: alchemyWebhookId("polygon"),
      bsc: alchemyWebhookId("bsc")
    },
    private readonly http: AxiosInstance = httpClient({
      baseURL: "https://dashboard.alchemy.com/api",
      timeout: 10_000
    })
  ) {}

  async addAddresses(network: Network, addresses: string[]): Promise<void> {
    const unique = [...new Set(addresses.map((address) => address.toLowerCase()))];
    if (unique.length === 0) return;
    const webhookId = this.webhookIds[network];
    if (!this.authToken || !webhookId) {
      throw new AppError(
        `Alchemy Notify is not configured for ${network}`,
        503,
        "alchemy_notify_unconfigured"
      );
    }

    for (let index = 0; index < unique.length; index += ADDRESS_BATCH_SIZE) {
      const batch = unique.slice(index, index + ADDRESS_BATCH_SIZE);
      const { status, data } = await this.http.patch(
        "/update-webhook-addresses",
        {
          webhook_id: webhookId,
          addresses_to_add: batch,
          addresses_to_remove: []
        },
        {
          headers: {
            "Content-Type": "application/json",
            "X-Alchemy-Token": this.authToken
          }
        }
      );
      if (status >= 400) {
        const message =
          typeof data?.message === "string" ? data.message : `Alchemy Notify returned ${status}`;
        throw new AppError(message, 502, "alchemy_notify_failed");
      }
    }
  }
}

export function createChainAddressRegistrar(): ChainAddressRegistrar | null {
  return config().CHAIN_DETECTION_MODE === "alchemy" ? new AlchemyNotifyClient() : null;
}
