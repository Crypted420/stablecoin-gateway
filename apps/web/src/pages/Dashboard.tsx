import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMerchantPath } from "../merchant-context";
import { Banner, Stat, StatusPill, naira, when } from "../components/ui";
import type { Invoice, Reconciliation, Settlement } from "../types";

export function Dashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [error, setError] = useState("");
  const base = useMerchantPath();

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [i, s, r] = await Promise.all([
          api.get<{ invoices: Invoice[] }>(`${base}/invoices?limit=5`),
          api.get<{ settlements: Settlement[] }>(`${base}/settlements?limit=5`),
          api.get<Reconciliation>("/system/reconciliation")
        ]);
        if (!live) return;
        setInvoices(i.invoices);
        setSettlements(s.settlements);
        setReconciliation(r);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "Could not load the dashboard");
      }
    };
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [base]);

  const settled = settlements.filter((s) => s.status === "completed");
  const total = settled.reduce((sum, s) => sum + Number(s.amountNgn), 0);

  return (
    <div className="page">
      <h1>Overview</h1>
      <p className="lede">Payments settle without any action from you.</p>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="grid">
        <Stat label="Open invoices" value={invoices.filter((i) => i.status === "pending").length} />
        <Stat label="Awaiting confirmation" value={invoices.filter((i) => i.status === "detected").length} />
        <Stat label="Settled (recent)" value={settled.length} />
        <Stat label="Paid out" value={naira(total.toFixed(2))} />
      </div>

      {reconciliation ? (
        <div className="card" style={{ marginTop: 20 }}>
          <h2>Reconciliation</h2>
          <table>
            <tbody>
              <tr>
                <td>Confirmed on chain</td>
                <td className="num mono">{naira(reconciliation.onChainTotalNgn)}</td>
              </tr>
              <tr>
                <td>Ledger debits / credits</td>
                <td className="num mono">
                  {naira(reconciliation.ledgerDebitTotal)} / {naira(reconciliation.ledgerCreditTotal)}
                </td>
              </tr>
              <tr>
                <td>Paid out</td>
                <td className="num mono">{naira(reconciliation.payoutTotalNgn)}</td>
              </tr>
              <tr>
                <td>Status</td>
                <td className="num">
                  <StatusPill status={reconciliation.balanced ? "completed" : "failed"} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="card">
        <h2>Recent invoices</h2>
        {invoices.length === 0 ? (
          <div className="empty">
            No invoices yet. <Link to="/invoices/new">Create one</Link>.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Amount</th>
                <th>Network</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <Link to={`/invoices/${invoice.id}`}>{invoice.reference}</Link>
                  </td>
                  <td className="mono">
                    {invoice.amountExpected} {invoice.tokenSymbol}
                  </td>
                  <td>{invoice.network}</td>
                  <td>
                    <StatusPill status={invoice.status} />
                  </td>
                  <td>{when(invoice.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
