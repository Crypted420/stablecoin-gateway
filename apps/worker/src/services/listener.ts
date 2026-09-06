import type { ChainSource, TransferObservation } from "@gateway/chain";
import { invoices, recordTransferObservation } from "@gateway/db";
import type { ChainAddressRegistrar } from "@gateway/providers";

export class ListenerService {
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly registeredTargets = new Set<string>();

  constructor(
    private readonly source: ChainSource,
    private readonly registrar: ChainAddressRegistrar | null = null
  ) {}

  async start(): Promise<void> {
    await this.refreshTargets();
    await this.source.start((observation) => this.onTransfer(observation));
    this.refreshTimer = setInterval(() => {
      void this.refreshTargets();
    }, 5000);
  }

  async refreshTargets(): Promise<void> {
    const targets = await invoices.activeDepositAddresses();
    this.source.setTargets(targets);
    if (this.registrar) {
      for (const network of ["polygon", "bsc"] as const) {
        const addresses = targets
          .filter((target) => target.network === network)
          .map((target) => target.address)
          .filter((address) => !this.registeredTargets.has(`${network}:${address.toLowerCase()}`));
        if (addresses.length === 0) continue;
        await this.registrar.addAddresses(
          network,
          addresses
        );
        for (const address of addresses) {
          this.registeredTargets.add(`${network}:${address.toLowerCase()}`);
        }
      }
    }
  }

  private async onTransfer(observation: TransferObservation): Promise<void> {
    await recordTransferObservation(observation);
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await this.source.stop();
  }
}
