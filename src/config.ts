import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";

export type AppConfig = {
  openrouterApiKey: string;
  openrouterModel: string;
  whisperBin?: string;
  ffmpegBin: string;
  ffprobeBin: string;
  segmentIntervalSeconds: number;
  frameDir: string;
  audioDir: string;
  agentCount: number;
};

const envSchema = z.object({
  OPENROUTER_API_KEY: z
    .string()
    .min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z
    .string()
    .trim()
    .default("mistralai/mistral-small-3.1-24b-instruct:free"),
  WHISPER_BIN: z.string().trim().optional(),
  FFMPEG_BIN: z.string().trim().default("ffmpeg"),
  FFMPEG_PROBE_BIN: z.string().trim().default("ffprobe"),
  SEGMENT_INTERVAL_SECONDS: z.coerce.number().positive().default(8),
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

  ensureDir(frameDir);
  ensureDir(audioDir);

  return {
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterModel: env.OPENROUTER_MODEL,
    whisperBin: env.WHISPER_BIN,
    ffmpegBin: env.FFMPEG_BIN,
    ffprobeBin: env.FFMPEG_PROBE_BIN,
    segmentIntervalSeconds: env.SEGMENT_INTERVAL_SECONDS,
    frameDir,
    audioDir,
    agentCount: env.AGENT_COUNT,
  };
}
