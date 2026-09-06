import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useMerchantPath } from "../merchant-context";
import { Banner, Field } from "../components/ui";
import type { Invoice, Network, Token } from "../types";

const TOKENS: Token[] = ["USDT", "USDC", "cNGN"];
const NETWORKS: Network[] = ["polygon", "bsc"];

export function NewInvoice() {
  const navigate = useNavigate();
  const [reference, setReference] = useState(`ORD-${Date.now().toString().slice(-8)}`);
  const [amountExpected, setAmount] = useState("100");
  const [tokenSymbol, setToken] = useState<Token>("USDT");
  const [network, setNetwork] = useState<Network>("polygon");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const base = useMerchantPath();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { invoice } = await api.post<{ invoice: Invoice }>(`${base}/invoices`, {
        reference,
        amountExpected,
        tokenSymbol,
        network
      });
      navigate(`/invoices/${invoice.id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <h1>New invoice</h1>
      <p className="lede">State what you expect to receive; the address is generated for you.</p>
      {error ? <Banner tone="error">{error}</Banner> : null}

      <div className="card" style={{ maxWidth: 560 }}>
        <form onSubmit={submit}>
          <Field label="Your reference" hint="Your own order number">
            <input value={reference} onChange={(e) => setReference(e.target.value)} required />
          </Field>
          <Field label="Amount expected">
            <input value={amountExpected} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <div className="row">
            <Field label="Token">
              <select value={tokenSymbol} onChange={(e) => setToken(e.target.value as Token)}>
                {TOKENS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Network">
              <select value={network} onChange={(e) => setNetwork(e.target.value as Network)}>
                {NETWORKS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="actions">
            <button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create invoice"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
