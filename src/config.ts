import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type AppConfig = {
  openrouterApiKey: string;
  openrouterModel: string;
  openrouterModelFallback: string[];
  openrouterModelMaxAttempts: number;
  logLevel: string;
  logModelOutput: boolean;
  agentOutputLog: boolean;
  agentOutputLogDir: string;
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
  OPENROUTER_MODEL_FALLBACK: z.string().trim().optional(),
  LOG_LEVEL: z.string().trim().default("info"),
  LOG_MODEL_OUTPUT: z.string().optional(),
  AGENT_OUTPUT_LOG: z.string().optional(),
  AGENT_OUTPUT_LOG_DIR: z.string().trim().default("data/agent-logs"),
  PROGRESS_UI: z.string().optional(),
  WHISPER_BIN: z.string().trim().optional(),
  WHISPER_ARGS: z.string().trim().optional(),
  FFMPEG_BIN: z.string().trim().default("ffmpeg"),
  FFMPEG_PROBE_BIN: z.string().trim().default("ffprobe"),
  SEGMENT_INTERVAL_SECONDS: z.coerce.number().positive().default(1),
  FRAME_DIR: z.string().trim().default("data/frames"),
  AUDIO_DIR: z.string().trim().default("data/audio"),
  AGENT_COUNT: z.coerce.number().int().positive().default(5),
  OPENROUTER_MODEL_MAX_ATTEMPTS: z.coerce.number().int().positive().optional(),
});

function ensureDir(dir: string) {
  mkdirSync(dir, { recursive: true });
}

export function loadConfig(cwd = process.cwd()): AppConfig {
  // Load a local `.env` file if present so running the server from the
  // workspace root still picks up env vars placed in the package folder.
  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const packageRoot = resolve(moduleDir, "..");
    const candidates = [resolve(cwd, ".env"), resolve(packageRoot, ".env")];
    for (const p of candidates) {
      try {
        const raw = readFileSync(p, { encoding: "utf8" });
        for (const line of raw.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq === -1) continue;
          const k = trimmed.slice(0, eq).trim();
          let v = trimmed.slice(eq + 1).trim();
          if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          // Don't override already-set env vars (explicit env should win)
          if (process.env[k] === undefined) process.env[k] = v;
        }
        // If we successfully read one file, stop (prefer cwd .env first)
        break;
      } catch (_err) {
        // ignore missing file
      }
    }
  } catch (_err) {
    // best-effort only; continue even if env loading fails
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Build clearer messages that include the path (env var key) so callers
    // can immediately see which environment variable is missing or invalid.
    const errorMessages = parsed.error.issues
      .map((e) => {
        const path = Array.isArray(e.path) && e.path.length ? e.path.join('.') : '(unknown)';
        return `${path}: ${e.message}`;
      })
      .join('\n');
    const msg = "❌ Configuration Error:\n" + errorMessages;
    console.error(msg);
    throw new Error(msg);
  }

  const env = parsed.data;
  const logModelOutput = parseBoolEnv(env.LOG_MODEL_OUTPUT, "LOG_MODEL_OUTPUT");
  const agentOutputLog =
    env.AGENT_OUTPUT_LOG === undefined ?
      logModelOutput
    : parseBoolEnv(env.AGENT_OUTPUT_LOG, "AGENT_OUTPUT_LOG");
  const frameDir = resolve(cwd, env.FRAME_DIR);
  const audioDir = resolve(cwd, env.AUDIO_DIR);
  const agentOutputLogDir = resolve(cwd, env.AGENT_OUTPUT_LOG_DIR);
  const progressUi =
    env.PROGRESS_UI === undefined ?
      Boolean((process.stderr as { isTTY?: boolean }).isTTY)
    : parseBoolEnv(env.PROGRESS_UI, "PROGRESS_UI");

  ensureDir(frameDir);
  ensureDir(audioDir);
  if (agentOutputLog) ensureDir(agentOutputLogDir);

  // Parse OPENROUTER_MODEL_FALLBACK which may be provided either as a
  // JSON array (e.g. ["a","b"]) or a comma-separated string.
  let parsedFallback: string[] = [];
  const rawFallback = env.OPENROUTER_MODEL_FALLBACK ?? "";
  const trimmedFallback = String(rawFallback).trim();
  if (trimmedFallback) {
    if (trimmedFallback.startsWith("[") && trimmedFallback.endsWith("]")) {
      try {
        const arr = JSON.parse(trimmedFallback);
        if (Array.isArray(arr)) {
          parsedFallback = arr.map((x) => String(x).trim()).filter(Boolean);
        } else {
          parsedFallback = trimmedFallback.split(",").map((s) => s.trim()).filter(Boolean);
        }
      } catch (_err) {
        // If JSON parsing fails, fall back to comma-splitting.
        parsedFallback = trimmedFallback.split(",").map((s) => s.trim()).filter(Boolean);
      }
    } else {
      parsedFallback = trimmedFallback.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }

  return {
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterModel: env.OPENROUTER_MODEL,
    openrouterModelFallback: parsedFallback,
    openrouterModelMaxAttempts: env.OPENROUTER_MODEL_MAX_ATTEMPTS ?? (1 + parsedFallback.length),
    logLevel: env.LOG_LEVEL,
    logModelOutput,
    agentOutputLog,
    agentOutputLogDir,
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
