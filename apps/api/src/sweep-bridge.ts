import axios from "axios";
import { config } from "@gateway/core";

async function post<T>(path: string, body: unknown = {}): Promise<{ ok: boolean; data?: T; message?: string }> {
  try {
    const { status, data } = await axios.post<T & { message?: string }>(path, body, {
      baseURL: config().WORKER_CONTROL_URL,
      timeout: 240_000,
      validateStatus: () => true,
      headers: { Authorization: `Bearer ${config().ADMIN_API_KEY}` }
    });
    if (status >= 400) return { ok: false, message: data?.message ?? `Worker returned ${status}` };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export const fundDepositWallet = (paymentId: string) =>
  post<{ sweep: unknown }>(`/wallet-sweeps/${paymentId}/fund`);

export const sweepDepositWallet = (paymentId: string) =>
  post<{ sweep: unknown }>(`/wallet-sweeps/${paymentId}/execute`);

export const runWalletSweeps = (action: "fund" | "sweep") =>
  post<{ processed: number; succeeded: number; failed: Array<{ paymentId: string; error: string }> }>(
    "/wallet-sweeps/run",
    { action }
  );
