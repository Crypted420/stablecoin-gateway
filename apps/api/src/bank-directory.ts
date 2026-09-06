import { createBankDirectory, type BankDirectory } from "@gateway/providers";

let instance: BankDirectory | null = null;

export function bankDirectory(): BankDirectory {
  if (!instance) instance = createBankDirectory();
  return instance;
}

export function setBankDirectoryForTests(directory: BankDirectory | null): void {
  if (process.env.NODE_ENV !== "test") throw new Error("Bank directory injection is test-only");
  instance = directory;
}
