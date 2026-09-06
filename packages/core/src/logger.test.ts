import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";

const savedLogLevel = process.env.LOG_LEVEL;

afterEach(() => {
  if (savedLogLevel === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = savedLogLevel;
  vi.restoreAllMocks();
});

describe("structured logger levels", () => {
  it("hides debug startup messages at the default info level", () => {
    delete process.env.LOG_LEVEL;
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const log = createLogger("worker");
    log.debug("consumer started");
    log.info("payment detected");
    expect(output).toHaveBeenCalledOnce();
    expect(output.mock.calls[0]?.[0]).toContain('"message":"payment detected"');
  });

  it("can restrict output to warnings and errors", () => {
    process.env.LOG_LEVEL = "warn";
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const log = createLogger("worker");
    log.info("payment detected");
    log.warn("provider unavailable");
    log.error("worker failed");
    expect(output).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalledOnce();
  });
});
