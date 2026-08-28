#!/usr/bin/env node
import { runCli } from "../src/cli.mjs";

try {
  await runCli(process.argv.slice(2));
} catch (error) {
  console.error(JSON.stringify({ error: error.code || "CLI_ERROR", message: error.message }, null, 2));
  process.exitCode = 1;
}
