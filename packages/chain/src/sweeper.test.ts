import { describe, expect, it } from "vitest";
import { gasBudget } from "./sweeper.js";

describe("treasury sweep gas budget", () => {
  it("adds the configured basis-point buffer without using floating point", () => {
    expect(gasBudget(100_000n, 30_000_000_000n, 13_000)).toBe(3_900_000_000_000_000n);
  });

  it("rounds up so the budget never underfunds by a wei", () => {
    expect(gasBudget(1n, 1n, 10_001)).toBe(2n);
  });
});
