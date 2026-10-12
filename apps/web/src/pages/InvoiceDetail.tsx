import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { useMerchantPath } from "../merchant-context";
import { Banner, StatusPill, naira, shortHash, when } from "../components/ui";
import { DepositAddress } from "../components/DepositAddress";
import type { Invoice, Payment, Settlement } from "../types";

interface Detail {
  invoice: Invoice;
  payment: Payment | null;
  settlement: Settlement | null;
}

export function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const base = useMerchantPath();

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setDetail(await api.get<Detail>(`${base}/invoices/${id}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the invoice");
    }
  }, [id, base]);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [load]);

  if (!detail) return <div className="page">{error ? <Banner tone="error">{error}</Banner> : "Loading…"}</div>;

  const { invoice, payment, settlement } = detail;

  return (
    <div className="page">
      <h1>{invoice.reference}</h1>
      <p className="lede">
        {invoice.amountExpected} {invoice.tokenSymbol} on {invoice.network} &middot;{" "}
        <StatusPill status={invoice.status} />
      </p>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <DepositAddress key={invoice.id} invoice={invoice} />

      <div className="card">
        <h2>Progress</h2>
        <ul className="timeline">
          <li>
            <span className="step">Invoice created</span>
            <span className="detail">{when(invoice.createdAt)}</span>
          </li>
          <li>
            <span className="step">Payment detected</span>
            <span className="detail">
              {payment ? (
                <>
                  {when(payment.detectedAt)} &middot;{" "}
                  <span className="mono">{shortHash(payment.txHash)}</span>
                </>
              ) : (
                "Waiting for a transfer"
              )}
            </span>
          </li>
          <li>
            <span className="step">Confirmed</span>
            <span className="detail">
              {payment?.confirmedAt
                ? `${when(payment.confirmedAt)} · ${payment.confirmations} confirmations`
                : payment
                  ? `${payment.confirmations} confirmations so far`
                  : "—"}
            </span>
          </li>
          <li>
            <span className="step">Rate locked</span>
            <span className="detail">
              {settlement
                ? settlement.quoteRate
                  ? `${settlement.quoteRate} NGN per ${invoice.tokenSymbol}`
                  : "Par value (cNGN)"
                : "—"}
            </span>
          </li>
          <li>
            <span className="step">Naira paid out</span>
            <span className="detail">
              {settlement?.completedAt
                ? `${naira(settlement.amountNgn)} · ${when(settlement.completedAt)}`
                : settlement
                  ? `${settlement.status}${settlement.lastError ? ` — ${settlement.lastError}` : ""}`
                  : "—"}
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
