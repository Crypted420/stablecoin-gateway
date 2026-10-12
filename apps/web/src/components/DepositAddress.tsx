import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Invoice } from "../types";

type DepositInvoice = Pick<Invoice, "depositAddress" | "amountExpected" | "tokenSymbol" | "network" | "status" | "expiresAt">;

export function DepositAddress({ invoice }: { invoice: DepositInvoice }) {
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const network = invoice.network === "polygon" ? "Polygon" : "BNB Smart Chain (BSC)";
  const expired = invoice.status === "expired" ||
    (invoice.status === "pending" && new Date(invoice.expiresAt).getTime() <= Date.now());
  const acceptingDeposit = invoice.status === "pending" && !expired;

  useEffect(() => setCopyStatus("idle"), [invoice.depositAddress]);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(invoice.depositAddress);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  }

  return (
    <section className="card" aria-labelledby="deposit-heading">
      <h2 id="deposit-heading">Deposit address</h2>
      <div className={acceptingDeposit ? "deposit-layout" : undefined}>
        {acceptingDeposit ? (
          <figure className="deposit-qr">
            <QRCodeSVG
              value={invoice.depositAddress}
              size={224}
              level="M"
              marginSize={4}
              bgColor="#ffffff"
              fgColor="#000000"
              role="img"
              title={`Deposit address for ${invoice.tokenSymbol} on ${network}`}
              aria-label={`Scan deposit address for ${invoice.tokenSymbol} on ${network}`}
            />
            <figcaption>Scan with your wallet</figcaption>
          </figure>
        ) : null}
        <div className="deposit-details">
          {acceptingDeposit ? (
            <>
              <p className="deposit-amount">{invoice.amountExpected} {invoice.tokenSymbol}</p>
              <p className="deposit-network">Network: <strong>{network}</strong></p>
              <p className="deposit-instructions">
                Scan the QR code or copy the address below. Select {invoice.tokenSymbol} on {network}
                {" "}in your wallet and enter the exact amount shown above.
              </p>
            </>
          ) : (
            <p className="deposit-instructions">
              {expired
                ? "This invoice has expired. Create a new invoice to make a deposit."
                : "Payment received. Follow its confirmation and settlement below."}
            </p>
          )}
          <div className="address">{invoice.depositAddress}</div>
          <div className="actions deposit-copy">
            <button type="button" className="secondary" onClick={() => void copyAddress()}>
              Copy address
            </button>
            <span className="deposit-copy-status" role="status">
              {copyStatus === "copied" ? "Address copied" : ""}
            </span>
          </div>
          {copyStatus === "error" ? (
            <p className="deposit-copy-error" role="alert">
              Could not copy automatically. Select and copy the address above.
            </p>
          ) : null}
          <p className="deposit-note">
            {acceptingDeposit
              ? `Only send ${invoice.tokenSymbol} on ${network}. Payment detection is automatic.`
              : "This address is unique to this invoice."}
          </p>
        </div>
      </div>
    </section>
  );
}
