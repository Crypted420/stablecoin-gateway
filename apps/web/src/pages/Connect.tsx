import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useMerchant } from "../merchant-context";
import { Banner, Field } from "../components/ui";
import type { Bank, Merchant } from "../types";

const ACCOUNT_LENGTH = 10;
const RESOLVE_DEBOUNCE_MS = 350;

export function Connect() {
  const { resolve } = useMerchant();
  const navigate = useNavigate();
  const [banks, setBanks] = useState<Bank[]>([]);
  const [accountNumber, setAccountNumber] = useState("");
  const [bankCode, setBankCode] = useState("");
  const [resolved, setResolved] = useState<Merchant | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<{ banks: Bank[] }>("/banks")
      .then((body) => setBanks(body.banks))
      .catch(() => setError("The bank list could not be loaded. Check that the API is running."));
  }, []);

  const ready = accountNumber.length === ACCOUNT_LENGTH && bankCode !== "";

  useEffect(() => {
    if (!ready) {
      setResolved(null);
      setError("");
      setBusy(false);
      return;
    }

    let live = true;
    setBusy(true);
    setResolved(null);
    setError("");
    const timer = window.setTimeout(() => {
      resolve(accountNumber, bankCode)
        .then((merchant) => {
          if (live) setResolved(merchant);
        })
        .catch((caught: unknown) => {
          if (!live) return;
          setResolved(null);
          setError(caught instanceof Error ? caught.message : "That account could not be resolved");
        })
        .finally(() => {
          if (live) setBusy(false);
        });
    }, RESOLVE_DEBOUNCE_MS);

    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [accountNumber, bankCode, ready, resolve]);

  return (
    <div className="page auth">
      <div className="card">
        <h1>Settle into your bank account</h1>
        <p className="lede">
          Enter the account stablecoin payments should be settled into. Your bank confirms the holder,
          and that confirmation is your account here — there is nothing to register.
        </p>

        {error ? <Banner tone="error">{error}</Banner> : null}

        <Field label="Bank account number" hint={`${accountNumber.length} of ${ACCOUNT_LENGTH} digits`}>
          <input
            inputMode="numeric"
            autoComplete="off"
            value={accountNumber}
            placeholder="0123456789"
            onChange={(event) =>
              setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, ACCOUNT_LENGTH))
            }
          />
        </Field>

        <Field label="Bank" hint={banks.length ? undefined : "Loading banks…"}>
          <select value={bankCode} onChange={(event) => setBankCode(event.target.value)}>
            <option value="">Select your bank</option>
            {banks.map((bank) => (
              <option key={bank.code} value={bank.code}>
                {bank.name}
              </option>
            ))}
          </select>
        </Field>

        {busy ? <div className="resolving">Confirming the account with the bank…</div> : null}

        {resolved ? (
          <div className="resolved">
            <div className="label">Account confirmed</div>
            <div className="name">{resolved.accountName}</div>
            <div className="detail">
              {resolved.bankName} · {resolved.bankAccountNumber}
            </div>
          </div>
        ) : null}

        <div className="actions">
          <button type="button" disabled={!resolved} onClick={() => navigate("/invoices/new")}>
            Continue to deposit
          </button>
        </div>
      </div>
    </div>
  );
}
