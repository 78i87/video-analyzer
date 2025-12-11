import { loadConfig } from "./config";
import { OpenRouterClient } from "./openrouterClient";
import { runAgent, type AgentPersona } from "./agentRunner";
import { segmentVideo } from "./videoSegmenter";

export async function buildSimulation(videoPath: string) {
  const config = loadConfig();

  const segments = await segmentVideo(videoPath, {
    ffmpegBin: config.ffmpegBin,
    ffprobeBin: config.ffprobeBin,
    whisperBin: config.whisperBin,
    frameDir: config.frameDir,
    audioDir: config.audioDir,
    segmentIntervalSeconds: config.segmentIntervalSeconds,
  });

  const client = new OpenRouterClient(config.openrouterApiKey, config.openrouterModel);

  const personas: AgentPersona[] = Array.from({ length: config.agentCount }).map(
    (_, idx) => ({
      id: `agent-${idx + 1}`,
      // TODO: replace with finalized watcher system prompt template (plan: video-virality-sim prompt TODO)
      systemPrompt: `You are retention reviewer #${idx + 1}. Decide if the viewer keeps watching or quits after each clip.`,
    }),
  );

  // Run agents sequentially for now; parallel orchestration will be added with real streaming
  const results = await Promise.all(
    personas.map((persona) => runAgent(persona, segments, { client, tools: [] })),
  );

  return {
    config,
    segments,
    results,
  };
}
