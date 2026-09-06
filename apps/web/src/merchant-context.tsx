import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, clearMerchantId, setMerchantId, storedMerchantId } from "./api";
import type { Merchant } from "./types";

interface MerchantState {
  merchant: Merchant | null;
  loading: boolean;
  resolve(bankAccountNumber: string, bankCode: string): Promise<Merchant>;
  disconnect(): void;
}

const MerchantContext = createContext<MerchantState | null>(null);

export function MerchantProvider({ children }: { children: ReactNode }) {
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [loading, setLoading] = useState(true);

  const restore = useCallback(async () => {
    const id = storedMerchantId();
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const { merchant: found } = await api.get<{ merchant: Merchant }>(`/merchants/${id}`);
      setMerchant(found);
    } catch {
      clearMerchantId();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const resolve = useCallback(async (bankAccountNumber: string, bankCode: string) => {
    const { merchant: resolved } = await api.post<{ merchant: Merchant }>("/merchants/resolve", {
      bankAccountNumber,
      bankCode
    });
    setMerchantId(resolved.id);
    setMerchant(resolved);
    return resolved;
  }, []);

  const disconnect = useCallback(() => {
    clearMerchantId();
    setMerchant(null);
  }, []);

  const value = useMemo<MerchantState>(
    () => ({
      merchant,
      loading,
      resolve,
      disconnect
    }),
    [disconnect, loading, merchant, resolve]
  );

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant(): MerchantState {
  const context = useContext(MerchantContext);
  if (!context) throw new Error("useMerchant must be used inside MerchantProvider");
  return context;
}

export function useMerchantPath(): string {
  const { merchant } = useMerchant();
  if (!merchant) throw new Error("No merchant is connected");
  return `/merchants/${merchant.id}`;
}
