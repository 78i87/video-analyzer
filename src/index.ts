import { loadConfig } from "./config";
import { OpenRouterClient } from "./openrouterClient";
import { runAgent, type AgentPersona, viewerTools } from "./agentRunner";
import { segmentVideo } from "./videoSegmenter";
import { logger, setLogLevel } from "./logger";
import { MultiAgentProgressUi } from "./progressUi";
import { summarizeSimulation } from "./simulationSummary";

export async function buildSimulation(videoPath: string) {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info(
    `Config: model=${config.openrouterModel} agents=${config.agentCount} interval=${config.segmentIntervalSeconds}s`,
  );

  if (config.logModelOutput) {
    logger.info("Model output logging: enabled");
  }
  logger.debug(
    `Binaries: ffmpeg=${config.ffmpegBin} ffprobe=${config.ffprobeBin} whisper=${config.whisperBin ?? "(unset)"}`,
  );

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

  const client = new OpenRouterClient(config.openrouterApiKey, config.openrouterModel);

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

    return {
      config,
      segments,
      results,
      summary,
    };
  } finally {
    ui?.stop({ newline: !finishedOk });
  }
}
