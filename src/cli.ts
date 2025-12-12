#!/usr/bin/env bun
import { buildSimulation } from "./index";
import { existsSync } from "node:fs";
import { resolveVideoPathArg } from "./cliArgs";

async function main() {
  const rawArgs = process.argv.slice(2);
  const resolved = resolveVideoPathArg(rawArgs, existsSync);

  if (!resolved.ok) {
    console.error(resolved.message);
    process.exitCode = 1;
    return;
  }

  try {
    const outcome = await buildSimulation(resolved.videoPath);
    console.log("Segments prepared:", outcome.segments.length);
    console.log("Agents simulated:", outcome.results.length);
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exitCode = 1;
  }
}

void main();
