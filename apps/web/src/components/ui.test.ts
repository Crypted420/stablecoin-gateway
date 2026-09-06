import { describe, expect, it } from "vitest";
import { shortHash, when } from "./ui";

describe("display helpers", () => {
  it("shortens long transaction hashes without losing both ends", () => {
    expect(shortHash("0x1234567890abcdef1234567890abcdef")).toBe("0x12345678…abcdef");
  });

  it("shows an em dash for a missing timestamp", () => {
    expect(when(null)).toBe("—");
  });
});
