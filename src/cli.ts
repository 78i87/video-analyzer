#!/usr/bin/env bun
import { buildSimulation } from "./index";
import { existsSync } from "node:fs";
import { resolveVideoPathArg } from "./cliArgs";
import { formatSeconds } from "./utils/formatting";

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
    const progressUiEnabled =
      outcome.config.progressUi &&
      !outcome.config.logModelOutput &&
      Boolean((process.stderr as { isTTY?: boolean }).isTTY);

    if (!progressUiEnabled) {
      console.log("Segments prepared:", outcome.segments.length);
      console.log("Agents simulated:", outcome.results.length);
      const duration = formatSeconds(outcome.summary.videoDurationSeconds);
      for (const row of outcome.summary.perAgent) {
        const status =
          row.stopSegmentIndex === undefined ?
            `watched full ${duration}`
          : `quit video at ${formatSeconds(row.watchSeconds)}`;
        console.log(`${row.agentId}: ${status}`);
      }
      console.log(
        `Average watch time: ${formatSeconds(outcome.summary.averageWatchSeconds)} / ${duration}`,
      );
    }
  } catch (err) {
    console.error("Simulation failed:", err);
    process.exitCode = 1;
  }
}

void main();
