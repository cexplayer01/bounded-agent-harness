#!/usr/bin/env node
import { assertPackageSafe } from "../src/package-audit.mjs";
import { fileURLToPath } from "node:url";

try {
  const result = await assertPackageSafe(fileURLToPath(new URL("..", import.meta.url)));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: error.code || "AUDIT_ERROR", message: error.message, details: error.details }, null, 2));
  process.exitCode = 1;
}
