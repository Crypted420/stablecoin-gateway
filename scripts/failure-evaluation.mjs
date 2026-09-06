import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const runId = `failure-injection-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const directory = resolve(process.cwd(), process.env.EVAL_OUTPUT_DIR ?? "evaluation-results", runId);
const rawPath = join(directory, "vitest.json");
const summaryPath = join(directory, "summary.json");
await mkdir(directory, { recursive: true });

const startedAt = new Date().toISOString();
const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@gateway/worker",
    "exec",
    "vitest",
    "run",
    "src/failure-injection.test.ts",
    "--reporter=json",
    `--outputFile=${rawPath}`
  ],
  { cwd: process.cwd(), env: process.env, encoding: "utf8" }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

let assertions = [];
try {
  const raw = JSON.parse(await readFile(rawPath, "utf8"));
  assertions = (raw.testResults ?? []).flatMap((suite) => suite.assertionResults ?? []);
} catch {
  // The process result below still records a runner failure if Vitest produced no JSON.
}

const requiredConditions = [
  "consumer-killed-mid-processing",
  "replayed-event",
  "reorg",
  "payout-timeout"
];
const conditions = Object.fromEntries(
  requiredConditions.map((condition) => {
    const assertion = assertions.find((entry) => String(entry.fullName ?? entry.title).includes(`[${condition}]`));
    return [
      condition,
      {
        passed: assertion?.status === "passed",
        title: assertion?.fullName ?? assertion?.title ?? null,
        failureMessages: assertion?.failureMessages ?? []
      }
    ];
  })
);
const passed = result.status === 0 && Object.values(conditions).every((condition) => condition.passed);
const summary = {
  runId,
  startedAt,
  completedAt: new Date().toISOString(),
  scope: "deterministic service-level fault injection",
  passed,
  conditions,
  rawEvidence: rawPath,
  exitCode: result.status
};
await writeFile(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
console.log(`Failure-injection evidence written to ${directory}`);
if (!passed) process.exitCode = 1;
