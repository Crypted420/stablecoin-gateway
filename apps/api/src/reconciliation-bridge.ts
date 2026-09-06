import axios from "axios";
import { config, type ReconciliationReport } from "@gateway/core";

export async function runReconciliation(
  periodStart: string,
  periodEnd: string
): Promise<{ ok: boolean; report?: ReconciliationReport; message?: string }> {
  try {
    const { status, data } = await axios.post<ReconciliationReport & { message?: string }>(
      "/reconciliation/run",
      { periodStart, periodEnd },
      {
        baseURL: config().WORKER_CONTROL_URL,
        timeout: 240_000,
        validateStatus: () => true,
        headers: { Authorization: `Bearer ${config().ADMIN_API_KEY}` }
      }
    );
    if (status >= 400) return { ok: false, message: data?.message ?? `Worker returned ${status}` };
    return { ok: true, report: data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
