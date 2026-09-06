import { describe, expect, it } from "vitest";
import { AccountResolutionError, PaystackBankDirectory } from "./banks.js";
import { httpClient } from "./http.js";

const bank = (n: number) => ({
  name: `Bank ${String(n).padStart(3, "0")}`,
  code: String(1000 + n),
  slug: `bank-${n}`
});

const paged = (pages: Array<Array<{ name: string; code: string; slug: string }>>, count?: () => void) =>
  httpClient({
    adapter: async (config) => {
      count?.();
      const page = Number((config.params as { page?: number } | undefined)?.page ?? 1);
      return {
        status: 200,
        statusText: "",
        headers: {},
        config,
        data: { status: true, data: pages[page - 1] ?? [] }
      };
    }
  });

const replying = (status: number, body: unknown) =>
  httpClient({
    adapter: async (config) => ({ status, statusText: "", headers: {}, config, data: body })
  });

describe("PaystackBankDirectory", () => {
  it("walks every page and stops when one comes back short", async () => {
    const full = Array.from({ length: 100 }, (_, i) => bank(i));
    const tail = Array.from({ length: 40 }, (_, i) => bank(100 + i));

    const banks = await new PaystackBankDirectory("", paged([full, tail])).listBanks();
    expect(banks).toHaveLength(140);
  });

  it("returns the list in name order", async () => {
    const http = replying(200, {
      status: true,
      data: [
        { name: "Zenith Bank", code: "057", slug: "zenith" },
        { name: "Access Bank", code: "044", slug: "access" }
      ]
    });

    const banks = await new PaystackBankDirectory("", http).listBanks();
    expect(banks.map((b) => b.name)).toEqual(["Access Bank", "Zenith Bank"]);
  });

  it("caches, so a second call does not query the provider again", async () => {
    let calls = 0;
    const directory = new PaystackBankDirectory("", paged([[bank(1)]], () => (calls += 1)));

    await directory.listBanks();
    await directory.listBanks();
    expect(calls).toBe(1);
  });

  it("reports a rejected key rather than returning an empty list", async () => {
    const http = replying(401, { status: false, message: "Invalid key" });
    await expect(new PaystackBankDirectory("", http).listBanks()).rejects.toThrow("Invalid key");
  });

  it("names the account holder the bank returns", async () => {
    const http = httpClient({
      adapter: async (config) => ({
        status: 200,
        statusText: "",
        headers: {},
        config,
        data:
          config.url === "/bank/resolve"
            ? { status: true, data: { account_number: "0123456789", account_name: "PIUS SAMSON" } }
            : { status: true, data: [{ name: "Guaranty Trust Bank", code: "058", slug: "gtb" }] }
      })
    });

    const account = await new PaystackBankDirectory("", http).resolveAccount("0123456789", "058");
    expect(account).toEqual({
      accountNumber: "0123456789",
      accountName: "PIUS SAMSON",
      bankCode: "058",
      bankName: "Guaranty Trust Bank"
    });
  });

  it("rejects an account the bank does not recognise", async () => {
    const http = replying(422, { status: false, message: "Could not resolve account name" });
    await expect(
      new PaystackBankDirectory("", http).resolveAccount("0000000000", "058")
    ).rejects.toBeInstanceOf(AccountResolutionError);
  });
});
