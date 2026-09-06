import type { ReactElement } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { MerchantProvider, useMerchant } from "./merchant-context";
import { Connect } from "./pages/Connect";
import { Dashboard } from "./pages/Dashboard";
import { InvoiceDetail } from "./pages/InvoiceDetail";
import { Invoices } from "./pages/Invoices";
import { NewInvoice } from "./pages/NewInvoice";
import { Settlements } from "./pages/Settlements";
import { Admin } from "./pages/Admin";

function Nav() {
  const { merchant, disconnect } = useMerchant();
  const { pathname } = useLocation();
  if (!merchant) return null;

  const link = (to: string, label: string) => (
    <Link to={to} className={pathname === to ? "active" : undefined}>
      {label}
    </Link>
  );

  return (
    <header className="topbar">
      <div className="brand">
        Stablecoin Gateway<span>{merchant.accountName}</span>
      </div>
      <nav className="nav">
        {link("/", "Overview")}
        {link("/invoices", "Invoices")}
        {link("/settlements", "Settlements")}
        <button type="button" className="secondary" onClick={disconnect}>
          Switch account
        </button>
      </nav>
    </header>
  );
}

function Connected({ children }: { children: ReactElement }) {
  const { merchant, loading } = useMerchant();
  if (loading) return <div className="page">Loading…</div>;
  return merchant ? children : <Navigate to="/connect" replace />;
}

export function App() {
  return (
    <BrowserRouter>
      <MerchantProvider>
        <div className="shell">
          <Nav />
          <Routes>
            <Route path="/admin" element={<Admin />} />
            <Route path="/connect" element={<Connect />} />
            <Route path="/" element={<Connected><Dashboard /></Connected>} />
            <Route path="/invoices" element={<Connected><Invoices /></Connected>} />
            <Route path="/invoices/new" element={<Connected><NewInvoice /></Connected>} />
            <Route path="/invoices/:id" element={<Connected><InvoiceDetail /></Connected>} />
            <Route path="/settlements" element={<Connected><Settlements /></Connected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </MerchantProvider>
    </BrowserRouter>
  );
}
