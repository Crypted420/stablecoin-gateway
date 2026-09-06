import type { ReactNode } from "react";

const STATUS_TONE: Record<string, string> = {
  pending: "idle",
  detected: "warn",
  confirmed: "warn",
  submitted: "warn",
  settled: "ok",
  completed: "ok",
  expired: "idle",
  failed: "stop",
  dead_lettered: "stop",
  underpaid: "stop",
  overpaid: "stop",
  orphaned: "stop"
};

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill ${STATUS_TONE[status] ?? "idle"}`}>{status.replace(/_/g, " ")}</span>;
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

export function Banner({ tone, children }: { tone: "error" | "info"; children: ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>;
}

export function Field({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function naira(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return value.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 2 });
}

export function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

export function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}
