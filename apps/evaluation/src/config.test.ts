import { afterEach, describe, expect, it } from "vitest";
import { evaluationConfig } from "./config.js";

const keys = [
  "EVAL_LIVE",
  "EVAL_AMOUNT",
  "EVAL_RUNS",
  "EVAL_REPEATS",
  "EVAL_CONCURRENCY",
  "EVAL_NETWORKS"
] as const;
const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of keys) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("evaluation safety configuration", () => {
  it("is non-broadcasting unless live mode is explicitly enabled", () => {
    delete process.env.EVAL_LIVE;
    expect(evaluationConfig().live).toBe(false);
    process.env.EVAL_LIVE = "true";
    expect(evaluationConfig().live).toBe(true);
  });

  it("rejects amounts the invoice API cannot represent", () => {
    process.env.EVAL_AMOUNT = "0.123456789";
    expect(() => evaluationConfig()).toThrow(/8 decimal places/);
  });

  it("treats run count as total flows distributed over both networks", () => {
    process.env.EVAL_RUNS = "50";
    process.env.EVAL_CONCURRENCY = "50";
    process.env.EVAL_NETWORKS = "polygon,bsc";
    const config = evaluationConfig();
    expect(config.measuredFlows).toBe(50);
    expect(config.concurrency).toBe(50);
    expect(config.networks).toEqual(["polygon", "bsc"]);
  });

  it("supports explicit repeated configurations without changing the safe default", () => {
    delete process.env.EVAL_REPEATS;
    expect(evaluationConfig().repeats).toBe(1);
    process.env.EVAL_REPEATS = "3";
    expect(evaluationConfig().repeats).toBe(3);
  });
});
