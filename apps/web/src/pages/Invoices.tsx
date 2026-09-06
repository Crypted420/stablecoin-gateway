import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useMerchantPath } from "../merchant-context";
import { Banner, StatusPill, when } from "../components/ui";
import type { Invoice } from "../types";

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState("");
  const base = useMerchantPath();

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const { invoices: rows } = await api.get<{ invoices: Invoice[] }>(`${base}/invoices`);
        if (live) setInvoices(rows);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "Could not load invoices");
      }
    };
    void load();
    const timer = setInterval(load, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [base]);

  return (
    <div className="page">
      <h1>Invoices</h1>
      <p className="lede">Each invoice has its own deposit address.</p>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="actions" style={{ marginBottom: 18 }}>
        <Link to="/invoices/new">
          <button type="button">New invoice</button>
        </Link>
      </div>

      <div className="card">
        {invoices.length === 0 ? (
          <div className="empty">Nothing here yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Amount</th>
                <th>Token</th>
                <th>Network</th>
                <th>Deposit address</th>
                <th>Status</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <Link to={`/invoices/${invoice.id}`}>{invoice.reference}</Link>
                  </td>
                  <td className="mono num">{invoice.amountExpected}</td>
                  <td>{invoice.tokenSymbol}</td>
                  <td>{invoice.network}</td>
                  <td className="mono">{invoice.depositAddress}</td>
                  <td>
                    <StatusPill status={invoice.status} />
                  </td>
                  <td>{when(invoice.expiresAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
