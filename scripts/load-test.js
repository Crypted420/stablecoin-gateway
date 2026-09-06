import http from "k6/http";
import { check, fail, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const success = new Rate("settlement_success");
const settlementLatency = new Trend("settlement_latency_ms", true);

export const options = {
  scenarios: {
    concurrent_settlements: {
      executor: "constant-vus",
      vus: 50,
      duration: "1m"
    }
  },
  thresholds: {
    settlement_success: ["rate>0.95"],
    settlement_latency_ms: ["p(95)<60000"]
  }
};

const base = __ENV.API_URL || "http://localhost:4000/api";
const merchantId = __ENV.MERCHANT_ID;

export default function () {
  if (!merchantId) fail("Set MERCHANT_ID to a resolved merchant before running k6");
  const reference = `K6-${__VU}-${__ITER}-${Date.now()}`;
  const created = http.post(
    `${base}/merchants/${merchantId}/invoices`,
    JSON.stringify({ reference, amountExpected: "1.00", tokenSymbol: "cNGN", network: "polygon" }),
    { headers: { "Content-Type": "application/json" } }
  );
  if (!check(created, { "invoice created": (response) => response.status === 201 })) {
    success.add(false);
    return;
  }
  const invoice = created.json("invoice");
  const started = Date.now();
  const submitted = http.post(`${base}/merchants/${merchantId}/simulate/invoices/${invoice.id}/pay`, "{}");
  if (submitted.status !== 202) {
    success.add(false);
    return;
  }

  for (let attempt = 0; attempt < 65; attempt += 1) {
    const response = http.get(`${base}/merchants/${merchantId}/invoices/${invoice.id}`);
    if (response.status === 200 && response.json("settlement.status") === "completed") {
      success.add(true);
      settlementLatency.add(Date.now() - started);
      return;
    }
    sleep(1);
  }
  success.add(false);
}
