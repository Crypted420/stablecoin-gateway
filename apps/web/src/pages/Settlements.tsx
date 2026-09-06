import { useEffect, useState } from "react";
import { api } from "../api";
import { useMerchantPath } from "../merchant-context";
import { Banner, StatusPill, naira, shortHash, when } from "../components/ui";
import type { Settlement } from "../types";

export function Settlements() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [error, setError] = useState("");
  const base = useMerchantPath();

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const { settlements: rows } = await api.get<{ settlements: Settlement[] }>(`${base}/settlements`);
        if (live) setSettlements(rows);
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : "Could not load settlements");
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [base]);

  async function download() {
    try {
      await api.downloadCsv(`${base}/reports/settlements?format=csv`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build the report");
    }
  }

  return (
    <div className="page">
      <h1>Settlements</h1>
      <p className="lede">Every payout, the rate it was priced at, and the provider reference.</p>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="actions" style={{ marginBottom: 18 }}>
        <button type="button" className="secondary" onClick={download}>
          Export CSV
        </button>
      </div>

      <div className="card">
        {settlements.length === 0 ? (
          <div className="empty">No settlements yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Transaction</th>
                <th>Rate</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Reference</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {settlements.map((settlement) => (
                <tr key={settlement.id}>
                  <td>{settlement.reference ?? "—"}</td>
                  <td className="mono">{settlement.txHash ? shortHash(settlement.txHash) : "—"}</td>
                  <td className="mono num">{settlement.quoteRate ?? "par"}</td>
                  <td className="num mono">{naira(settlement.amountNgn)}</td>
                  <td>
                    <StatusPill status={settlement.status} />
                  </td>
                  <td className="mono">{settlement.providerReference ?? "—"}</td>
                  <td>{when(settlement.completedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
