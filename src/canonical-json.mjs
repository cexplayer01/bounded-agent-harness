import { createHash } from "node:crypto";

export function canonicalize(value) {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => item === undefined ? "null" : canonicalize(item)).join(",")}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
