import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export type AppConfig = {
  openrouterApiKey: string;
  openrouterModel: string;
  logLevel: string;
  logModelOutput: boolean;
  progressUi: boolean;
  whisperBin?: string;
  whisperArgs?: string;
  ffmpegBin: string;
  ffprobeBin: string;
  segmentIntervalSeconds: number;
  frameDir: string;
  audioDir: string;
  agentCount: number;
};

function parseBoolEnv(value: string | undefined, label: string): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return false;
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  throw new Error(`${label} must be a boolean-like value (0/1/true/false/yes/no/on/off)`);
}

const envSchema = z.object({
  OPENROUTER_API_KEY: z
    .string()
    .min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z
    .string()
    .trim()
    .default("z-ai/glm-4.6v"),
  LOG_LEVEL: z.string().trim().default("info"),
  LOG_MODEL_OUTPUT: z.string().optional(),
  PROGRESS_UI: z.string().optional(),
  WHISPER_BIN: z.string().trim().optional(),
  WHISPER_ARGS: z.string().trim().optional(),
  FFMPEG_BIN: z.string().trim().default("ffmpeg"),
  FFMPEG_PROBE_BIN: z.string().trim().default("ffprobe"),
  SEGMENT_INTERVAL_SECONDS: z.coerce.number().positive().default(1),
  FRAME_DIR: z.string().trim().default("data/frames"),
  AUDIO_DIR: z.string().trim().default("data/audio"),
  AGENT_COUNT: z.coerce.number().int().positive().default(5),
});

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const message = parsed.error.errors
      .map((err) => `${err.path.join(".")}: ${err.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }

  const env = parsed.data;
  const frameDir = resolve(cwd, env.FRAME_DIR);
  const audioDir = resolve(cwd, env.AUDIO_DIR);
  const progressUi =
    env.PROGRESS_UI === undefined ?
      Boolean((process.stderr as { isTTY?: boolean }).isTTY)
    : parseBoolEnv(env.PROGRESS_UI, "PROGRESS_UI");

  ensureDir(frameDir);
  ensureDir(audioDir);

  return {
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterModel: env.OPENROUTER_MODEL,
    logLevel: env.LOG_LEVEL,
    logModelOutput: parseBoolEnv(env.LOG_MODEL_OUTPUT, "LOG_MODEL_OUTPUT"),
    progressUi,
    whisperBin: env.WHISPER_BIN,
    whisperArgs: env.WHISPER_ARGS,
    ffmpegBin: env.FFMPEG_BIN,
    ffprobeBin: env.FFMPEG_PROBE_BIN,
    segmentIntervalSeconds: env.SEGMENT_INTERVAL_SECONDS,
    frameDir,
    audioDir,
    agentCount: env.AGENT_COUNT,
  };
}
