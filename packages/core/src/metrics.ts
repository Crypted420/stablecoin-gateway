const counters = new Map<string, number>();
const observations = new Map<string, number[]>();

function key(name: string, labels: Record<string, string> = {}): string {
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`);
  return parts.length ? `${name}{${parts.join(",")}}` : name;
}

export function increment(name: string, labels?: Record<string, string>, by = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}

export function observe(name: string, value: number, labels?: Record<string, string>): void {
  const k = key(name, labels);
  const list = observations.get(k) ?? [];
  list.push(value);
  observations.set(k, list);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index] ?? 0;
}

export function summary(): Record<string, unknown> {
  const latency: Record<string, unknown> = {};
  for (const [k, values] of observations) {
    const sorted = [...values].sort((a, b) => a - b);
    latency[k] = {
      count: sorted.length,
      median: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      max: sorted[sorted.length - 1] ?? 0
    };
  }
  return { counters: Object.fromEntries(counters), latency };
}

export function renderPrometheus(): string {
  const lines: string[] = [];
  for (const [k, v] of counters) lines.push(`${k} ${v}`);
  for (const [k, values] of observations) {
    const sorted = [...values].sort((a, b) => a - b);
    const base = k.includes("{") ? k.slice(0, k.indexOf("{")) : k;
    const labels = k.includes("{") ? k.slice(k.indexOf("{") + 1, -1) : "";
    const withQ = (q: string) => (labels ? `${base}{${labels},quantile="${q}"}` : `${base}{quantile="${q}"}`);
    lines.push(`${withQ("0.5")} ${quantile(sorted, 0.5)}`);
    lines.push(`${withQ("0.95")} ${quantile(sorted, 0.95)}`);
    lines.push(`${base}_count${labels ? `{${labels}}` : ""} ${sorted.length}`);
  }
  return lines.join("\n") + "\n";
}

export function reset(): void {
  counters.clear();
  observations.clear();
}
