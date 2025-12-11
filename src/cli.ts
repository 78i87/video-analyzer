#!/usr/bin/env bun
import { buildSimulation } from "./index";

async function main() {
  const [, , videoPath] = process.argv;

  if (!videoPath) {
    console.error("Usage: bun start <path-to-video>");
    process.exitCode = 1;
    return;
  }

  try {
    const outcome = await buildSimulation(videoPath);
    console.log("Segments prepared:", outcome.segments.length);
    console.log("Agents simulated:", outcome.results.length);
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exitCode = 1;
  }
}

void main();
