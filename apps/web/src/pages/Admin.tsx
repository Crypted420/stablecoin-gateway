import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  adminApi,
  clearAdminKey,
  setAdminKey,
  storedAdminKey
} from "../api";
import { Banner, Field, Stat, StatusPill, shortHash, when } from "../components/ui";
import type { AdminOverview, AdminPayout, SweepCandidate } from "../types";

interface AdminData {
  overview: AdminOverview;
  wallets: SweepCandidate[];
  payouts: AdminPayout[];
}

function tokenAmount(raw: string | null, symbol: string, network: string): string {
  if (raw === null) return "Not inspected";
  const value = BigInt(raw);
  const decimals = network === "bsc" && (symbol === "USDT" || symbol === "USDC") ? 18 : 6;
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} ${symbol}`;
}

function nativeAmount(raw: string | null, network: string): string {
  if (raw === null) return "—";
  const symbol = network === "ethereum" ? "ETH" : network === "polygon" ? "POL" : "BNB";
  const value = BigInt(raw);
  const whole = value / 1_000_000_000_000_000_000n;
  const fraction = ((value % 1_000_000_000_000_000_000n) / 1_000_000_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} ${symbol}`;
}

export function Admin() {
  const [keyInput, setKeyInput] = useState(storedAdminKey());
  const [key, setKey] = useState(storedAdminKey());
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    if (!key) return;
    try {
      const [overview, wallets, payouts] = await Promise.all([
        adminApi.get<AdminOverview>("/overview", key),
        adminApi.get<{ wallets: SweepCandidate[] }>("/wallets", key),
        adminApi.get<{ settlements: AdminPayout[] }>("/payouts/pending", key)
      ]);
      setData({ overview, wallets: wallets.wallets, payouts: payouts.settlements });
      setError("");
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "Could not load administration data");
      if (cause instanceof ApiError && cause.status === 401) clearAdminKey();
    }
  }, [key]);

  useEffect(() => {
    void load();
    if (!key) return;
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  function unlock() {
    const value = keyInput.trim();
    if (!value) return;
    setAdminKey(value);
    setKey(value);
  }

  async function action(label: string, operation: () => Promise<unknown>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      const result = await operation();
      const batch = result as { processed?: number; succeeded?: number; failed?: unknown[] };
      setNotice(
        batch.processed === undefined
          ? `${label} completed.`
          : `${batch.succeeded ?? 0} of ${batch.processed} wallets completed; ${batch.failed?.length ?? 0} failed.`
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${label} failed`);
    } finally {
      setBusy("");
    }
  }

  if (!key || !data) {
    return (
      <div className="page auth">
        <div className="card">
          <h1>Operations administration</h1>
          <p className="lede">Enter the server-side admin key to manage payouts and treasury sweeps.</p>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Field label="Admin key" hint="Stored only for this browser tab.">
            <input
              type="password"
              value={keyInput}
              autoComplete="off"
              onChange={(event) => setKeyInput(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && unlock()}
            />
          </Field>
          <button type="button" onClick={unlock} disabled={!keyInput.trim()}>
            Open administration
          </button>
        </div>
      </div>
    );
  }

  const { overview, wallets, payouts } = data;
  return (
    <div className="page admin-page">
      <div className="admin-heading">
        <div>
          <h1>Operations administration</h1>
          <p className="lede">Automated payout monitoring, confirmed deposit wallets, gas funding, and treasury sweeps.</p>
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => void load()} disabled={Boolean(busy)}>
            Refresh
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              clearAdminKey();
              setKey("");
              setData(null);
            }}
          >
            Lock
          </button>
        </div>
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? <Banner tone="info">{notice}</Banner> : null}
      {!overview.treasuryConfigured || !overview.gasWalletConfigured ? (
        <Banner tone="error">
          Sweeping is disabled until TREASURY_ADDRESS and SWEEP_GAS_PRIVATE_KEY are configured.
        </Banner>
      ) : null}

      <div className="grid admin-stats">
        <Stat label="Merchants" value={overview.merchants} />
        <Stat label="Invoices" value={overview.invoices} />
        <Stat label="Confirmed wallets" value={overview.confirmedWallets} />
        <Stat label="Ready to sweep" value={overview.sweepable} />
        <Stat label="Swept" value={overview.swept} />
        <Stat label="Sweep failures" value={overview.failedSweeps} />
      </div>

      <div className="card">
        <div className="section-heading">
          <div>
            <h2>Treasury collection</h2>
            <div className="hint mono">Treasury: {overview.treasuryAddress ?? "Not configured"}</div>
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={Boolean(busy) || overview.sweepable === 0}
              onClick={() => void action("Fund all wallets", () => adminApi.post("/wallets/run", key, { action: "fund" }))}
            >
              {busy === "Fund all wallets" ? "Funding…" : "Fund gas for all"}
            </button>
            <button
              type="button"
              disabled={Boolean(busy) || overview.sweepable === 0}
              onClick={() => void action("Sweep all wallets", () => adminApi.post("/wallets/run", key, { action: "sweep" }))}
            >
              {busy === "Sweep all wallets" ? "Sweeping…" : "Fund & sweep all"}
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice / merchant</th>
                <th>Wallet</th>
                <th>Token balance</th>
                <th>Gas balance</th>
                <th>Status</th>
                <th>Transactions</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {wallets.map((wallet) => (
                <tr key={wallet.paymentId}>
                  <td>
                    <strong>{wallet.reference}</strong>
                    <div className="hint">{wallet.merchantName}</div>
                    <div className="hint">Confirmed {when(wallet.confirmedAt)}</div>
                  </td>
                  <td>
                    <div>{wallet.network} · {wallet.tokenSymbol}</div>
                    <div className="mono hint" title={wallet.depositAddress}>{shortHash(wallet.depositAddress)}</div>
                  </td>
                  <td className="mono">{tokenAmount(wallet.tokenBalanceRaw ?? wallet.depositedAmountRaw, wallet.tokenSymbol, wallet.network)}</td>
                  <td className="mono">
                    {nativeAmount(wallet.nativeBalanceRaw, wallet.network)}
                    {wallet.requiredGasRaw ? <div className="hint">Need {nativeAmount(wallet.requiredGasRaw, wallet.network)}</div> : null}
                  </td>
                  <td>
                    <StatusPill status={wallet.sweepStatus} />
                    {wallet.lastError ? <div className="cell-error">{wallet.lastError}</div> : null}
                  </td>
                  <td className="mono">
                    <div>Gas: {wallet.fundingTxHash ? shortHash(wallet.fundingTxHash) : "—"}</div>
                    <div>Sweep: {wallet.sweepTxHash ? shortHash(wallet.sweepTxHash) : "—"}</div>
                  </td>
                  <td>
                    <div className="actions compact-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={Boolean(busy) || ["completed", "empty"].includes(wallet.sweepStatus)}
                        onClick={() => void action("Fund wallet", () => adminApi.post(`/wallets/${wallet.paymentId}/fund`, key))}
                      >
                        Fund gas
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busy) || ["completed", "empty"].includes(wallet.sweepStatus)}
                        onClick={() => void action("Sweep wallet", () => adminApi.post(`/wallets/${wallet.paymentId}/sweep`, key))}
                      >
                        Sweep
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {wallets.length === 0 ? (
                <tr><td colSpan={7} className="empty">No confirmed deposit wallets yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="section-heading">
          <div>
            <h2>Payout monitoring</h2>
            <div className="hint">Submitted transfers await Paystack; failed transfers can be retried.</div>
          </div>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Invoice / merchant</th>
                <th>Conversion</th>
                <th>Bank destination</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => (
                <tr key={payout.id}>
                  <td>
                    <strong>{payout.reference}</strong>
                    <div className="hint">{payout.merchantName}</div>
                    <div className="mono hint" title={payout.txHash}>{shortHash(payout.txHash)}</div>
                  </td>
                  <td>
                    <div>{tokenAmount(payout.amountRaw, payout.tokenSymbol, payout.network)}</div>
                    <strong>₦{Number(payout.amountNgn).toLocaleString("en-NG", { minimumFractionDigits: 2 })}</strong>
                    <div className="hint">
                      {payout.valuationBasis === "par"
                        ? "Valuation: par · ₦1.00/cNGN"
                        : `Rate: ${payout.quoteRate ?? "unavailable"} NGN`}
                    </div>
                  </td>
                  <td>
                    <div>{payout.bankName}</div>
                    <div className="mono hint">{payout.bankAccountNumber}</div>
                  </td>
                  <td>
                    <StatusPill status={payout.status} />
                    <div className="hint">{when(payout.createdAt)}</div>
                    {payout.providerStatus ? <div className="hint">Paystack: {payout.providerStatus}</div> : null}
                    {payout.lastError ? <div className="cell-error">{payout.lastError}</div> : null}
                  </td>
                  <td>
                    <div className="actions compact-actions">
                      {payout.status === "failed" ? (
                        <button type="button" disabled={Boolean(busy)} onClick={() => void action("Retry payout", () => adminApi.post(`/payouts/${payout.id}/retry`, key))}>Retry payout</button>
                      ) : (
                        <span className="hint">Waiting for final status</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {payouts.length === 0 ? <tr><td colSpan={5} className="empty">No submitted or failed payouts.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
