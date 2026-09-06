import type { RequestHandler } from "express";

interface Bucket {
  startedAt: number;
  count: number;
}

export function rateLimit(windowMs: number, max: number): RequestHandler {
  const buckets = new Map<string, Bucket>();
  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 10_000) {
      for (const [candidate, value] of buckets) {
        if (now - value.startedAt >= windowMs) buckets.delete(candidate);
      }
    }
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const current = buckets.get(key);
    const bucket = !current || now - current.startedAt >= windowMs
      ? { startedAt: now, count: 0 }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.startedAt + windowMs - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({ error: "rate_limited", message: "Too many requests; try again shortly" });
      return;
    }
    next();
  };
}
