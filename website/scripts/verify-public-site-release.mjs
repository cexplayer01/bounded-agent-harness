function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const baseUrl = new URL(argument("--url", "https://boundedagentharness.com"));
if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
const expectedCommit = argument("--commit", null)?.toLowerCase() ?? null;
const receiptUrl = new URL("release.json", baseUrl);
const homepageUrl = new URL("", baseUrl);

async function fetchChecked(url) {
  const response = await fetch(url, { headers: { accept: "application/json,text/html" }, cache: "no-store" });
  const body = await response.text();
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return { response, body };
}

const receiptResponse = await fetchChecked(receiptUrl);
let receipt;
try {
  receipt = JSON.parse(receiptResponse.body);
} catch {
  throw new Error(`${receiptUrl} did not return JSON`);
}
if (receipt.format !== "bounded-agent-harness-public-release.v1") throw new Error("Unexpected release receipt format");
if (!/^[0-9a-f]{40}$/.test(receipt.sourceCommit)) throw new Error("Release receipt has no full source commit");
if (expectedCommit && receipt.sourceCommit !== expectedCommit) {
  throw new Error(`Source drift: expected ${expectedCommit}, live receipt has ${receipt.sourceCommit}`);
}
for (const field of ["sourceUrl", "proofStatusUrl", "websiteSourceSha256", "proofStatusSha256"]) {
  if (typeof receipt[field] !== "string" || receipt[field].length === 0) throw new Error(`Missing release field: ${field}`);
}
const homepage = await fetchChecked(homepageUrl);
if (!homepage.body.includes("/release.json")) throw new Error("Homepage does not link to the release receipt");

const result = {
  status: "PASS",
  url: baseUrl.href,
  receiptUrl: receiptUrl.href,
  sourceCommit: receipt.sourceCommit,
  capabilityMaturity: receipt.capabilityMaturity,
  homepageHttp: homepage.response.status,
  receiptHttp: receiptResponse.response.status,
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
