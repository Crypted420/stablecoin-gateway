import { readFileSync, writeFileSync } from "node:fs";

const url = new URL(process.argv[2] ?? "");
if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
  throw new Error("Usage: node scripts/configure-vercel-api.mjs https://api.example.com");
}
const config = JSON.parse(readFileSync("vercel.json", "utf8"));
const route = config.rewrites.find((rewrite) => rewrite.source === "/api/:path*");
if (!route) throw new Error("Vercel API rewrite is missing");
route.destination = `${url.origin}/api/:path*`;
writeFileSync("vercel.json", `${JSON.stringify(config, null, 2)}\n`);
console.log(`Vercel API routing configured for ${url.origin}. Redeploy Vercel to apply it.`);
