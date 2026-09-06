import axios from "axios";
import { config } from "@gateway/core";

export async function executePayout(settlementId: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const { status, data } = await axios.post<{ executed?: boolean; message?: string }>(
      `/settlements/${settlementId}/execute`,
      {},
      {
        baseURL: config().WORKER_CONTROL_URL,
        timeout: 30_000,
        validateStatus: () => true,
        headers: { Authorization: `Bearer ${config().ADMIN_API_KEY}` }
      }
    );
    if (status >= 400) return { ok: false, message: data?.message ?? `Worker returned ${status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
