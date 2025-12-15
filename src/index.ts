import { loadConfig } from "./config";
import { OpenRouterClient } from "./openrouterClient";
import { runAgent, type AgentPersona, viewerTools } from "./agentRunner";
import { createAgentOutputRecorder } from "./agentOutputRecorder";
import { segmentVideo } from "./videoSegmenter";
import { logger, setLogLevel } from "./logger";
import { MultiAgentProgressUi } from "./progressUi";
import { summarizeSimulation } from "./simulationSummary";
import { basename, join } from "node:path";

export async function buildSimulation(videoPath: string) {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info(
    `Config: model=${config.openrouterModel} agents=${config.agentCount} interval=${config.segmentIntervalSeconds}s`,
  );

  if (config.logModelOutput) logger.info("Model output logging: enabled (console)");
  logger.debug(
    `Binaries: ffmpeg=${config.ffmpegBin} ffprobe=${config.ffprobeBin} whisper=${config.whisperBin ?? "(unset)"}`,
  );

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const safeVideoName = basename(videoPath).replace(/[^a-zA-Z0-9._-]/g, "_");
  const agentOutputLogPath =
    config.agentOutputLog ?
      join(config.agentOutputLogDir, `${safeVideoName}-${runId}.jsonl`)
    : undefined;
  const outputRecorder =
    agentOutputLogPath ? await createAgentOutputRecorder(agentOutputLogPath) : undefined;
  if (outputRecorder) {
    logger.info(`Agent output log: ${outputRecorder.path}`);
    await outputRecorder.record({
      type: "run_start",
      ts: new Date().toISOString(),
      runId,
      videoPath,
      model: config.openrouterModel,
      agentCount: config.agentCount,
      segmentIntervalSeconds: config.segmentIntervalSeconds,
    });
  }

  const segments = await segmentVideo(videoPath, {
    ffmpegBin: config.ffmpegBin,
    ffprobeBin: config.ffprobeBin,
    whisperBin: config.whisperBin,
    frameDir: config.frameDir,
    audioDir: config.audioDir,
    segmentIntervalSeconds: config.segmentIntervalSeconds,
    whisperArgs: config.whisperArgs,
  });

  if (segments.length === 0) {
    logger.warn("Segments prepared: 0");
  }

  const client = new OpenRouterClient(config.openrouterApiKey, config.openrouterModel, {
    fallbackModels: config.openrouterModelFallback,
    maxAttempts: config.openrouterModelMaxAttempts,
  });

  const personas: AgentPersona[] = Array.from({ length: config.agentCount }).map(
    (_, idx) => ({
      id: `agent-${idx + 1}`,
      // TODO: replace with finalized watcher system prompt template (plan: video-virality-sim prompt TODO)
      systemPrompt: `You are retention reviewer #${idx + 1}. Decide if the viewer keeps watching or quits after each clip.`,
    }),
  );

  const progressUiEnabled =
    config.progressUi &&
    !config.logModelOutput &&
    Boolean((process.stderr as { isTTY?: boolean }).isTTY);

  const ui = progressUiEnabled
    ? new MultiAgentProgressUi({
        agents: personas.map((p) => p.id),
        segments,
      })
    : undefined;
  ui?.start();

  let finishedOk = false;
  try {
    // Run agents in parallel; each agent watches sequential segments.
    const results = await Promise.all(
      personas.map((persona) =>
        runAgent(persona, segments, {
          client,
          tools: viewerTools,
          logModelOutput: config.logModelOutput,
          outputRecorder,
          runId,
          suppressSegmentLogs: progressUiEnabled,
          reporter:
            ui ?
              {
                onSegment: (update) => ui.onSegment(update),
                onDone: (result) => ui.onDone(result.agentId, result.stopSegmentIndex),
              }
            : undefined,
        }),
      ),
    );

    const summary = summarizeSimulation(segments, results);
    if (ui) ui.finish(summary);
    finishedOk = true;

    if (outputRecorder) {
      const stopCounts: Record<string, number> = {};
      for (const result of results) {
        const key =
          result.stopSegmentIndex === undefined ? "full" : String(result.stopSegmentIndex);
        stopCounts[key] = (stopCounts[key] ?? 0) + 1;
      }
      await outputRecorder.record({
        type: "run_end",
        ts: new Date().toISOString(),
        runId,
        stopCounts,
      });
      await outputRecorder.flush();
    }

    return {
      config,
      segments,
      results,
      summary,
      agentOutputLogPath: outputRecorder?.path,
    };
  } catch (err) {
    if (outputRecorder) {
      await outputRecorder
        .record({
          type: "error",
          ts: new Date().toISOString(),
          runId,
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        })
        .catch(() => undefined);
      await outputRecorder.flush().catch(() => undefined);
    }
    throw err;
  } finally {
    ui?.stop({ newline: !finishedOk });
  }
}
