import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError, createLogger } from "@gateway/core";

const log = createLogger("api");

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: "not_found", message: "No such endpoint" });
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (error instanceof ZodError) {
    res.status(400).json({
      error: "validation_failed",
      message: "Some fields were not accepted",
      details: error.issues.map((i) => ({ field: i.path.join("."), message: i.message }))
    });
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }

  log.error("unhandled error", { error: String(error) });
  res.status(500).json({ error: "internal_error", message: "Something went wrong on our side" });
}
