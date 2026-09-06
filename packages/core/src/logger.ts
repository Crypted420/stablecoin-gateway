type Level = "debug" | "info" | "warn" | "error";

const PRIORITY: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

function enabled(level: Level): boolean {
  const configured = process.env.LOG_LEVEL?.toLowerCase() ?? "info";
  if (configured === "silent") return false;
  const threshold = PRIORITY[configured as Level] ?? PRIORITY.info;
  return PRIORITY[level] >= threshold;
}

function emit(level: Level, service: string, message: string, fields?: Record<string, unknown>) {
  if (!enabled(level)) return;
  const line = { ts: new Date().toISOString(), level, service, message, ...fields };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else console.log(text);
}

export function createLogger(service: string) {
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit("debug", service, m, f),
    info: (m: string, f?: Record<string, unknown>) => emit("info", service, m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit("warn", service, m, f),
    error: (m: string, f?: Record<string, unknown>) => emit("error", service, m, f)
  };
}

export type Logger = ReturnType<typeof createLogger>;
