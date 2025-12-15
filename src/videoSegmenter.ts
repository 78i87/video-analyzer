import { access } from "node:fs/promises";
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { logger } from "./logger";

export type Segment = {
  index: number;
  start: number;
  end: number;
  framePath: string;
  subtitle: string;
};

export type SegmenterConfig = {
  ffmpegBin: string;
  ffprobeBin: string;
  whisperBin?: string;
  whisperArgs?: string;
  frameDir: string;
  audioDir: string;
  segmentIntervalSeconds: number;
};

export type VideoInput =
  | string
  | { path: string }
  | { uploadDir: string }
  | { buffer: ArrayBuffer | ArrayBufferView | Uint8Array | Buffer; tempDir: string; filename?: string };

export class MissingBinaryError extends Error {
  constructor(binaryName: string, envKey: string) {
    super(
      `Required binary "${binaryName}" was not found in PATH. Set ${envKey} to the full path or install the tool.`,
    );
    this.name = "MissingBinaryError";
  }
}

async function assertExecutable(binary: string, envKey: string) {
  const looksLikePath = /[\\/]/.test(binary);
  if (looksLikePath) {
    await access(binary);
    return binary;
  }

  const located = await Bun.which(binary);
  if (!located) {
    throw new MissingBinaryError(binary, envKey);
  }
  await access(located);
  return located;
}

type ResolvedDependencies = {
  ffmpeg: string;
  ffprobe: string;
  whisper?: string;
};

export async function prepareSegmentDirs(frameDir: string, audioDir: string) {
  mkdirSync(frameDir, { recursive: true });
  mkdirSync(audioDir, { recursive: true });
}

export async function validateDependencies(
  config: SegmenterConfig,
): Promise<ResolvedDependencies> {
  const ffmpeg = await assertExecutable(config.ffmpegBin, "FFMPEG_BIN");
  const ffprobe = await assertExecutable(config.ffprobeBin, "FFMPEG_PROBE_BIN");
  const whisper = config.whisperBin
    ? await assertExecutable(config.whisperBin, "WHISPER_BIN")
    : undefined;

  logger.debug("Dependency check OK");
  return { ffmpeg, ffprobe, whisper };
}

async function runCommand(
  bin: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn([bin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const cmd = [bin, ...args].join(" ");
    throw new Error(
      `Command failed (exit ${exitCode}): ${cmd}\n\nSTDERR:\n${stderr}\n\nSTDOUT:\n${stdout}`,
    );
  }

  return { stdout, stderr };
}

async function getVideoDurationSeconds(
  ffprobe: string,
  inputPath: string,
): Promise<number> {
  const { stdout } = await runCommand(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath,
  ]);

  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error(`Unable to parse duration from ffprobe output: ${stdout}`);
  }
  return duration;
}

function sanitizePathComponent(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80);
}

function parseArgs(value: string | undefined): string[] {
  if (!value) return [];
  const matches = value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  return matches.map((token) => token.replaceAll(/^"|"$/g, ""));
}

function toUint8Array(data: ArrayBuffer | ArrayBufferView | Uint8Array | Buffer) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  throw new Error("Unsupported buffer input type");
}

function firstFileInDir(dir: string) {
  const entries = readdirSync(dir);
  for (const name of entries.sort((a, b) => a.localeCompare(b, "en"))) {
    const full = resolve(dir, name);
    try {
      const stat = statSync(full);
      if (stat.isFile()) return full;
    } catch (err) {
      logger.debug(`Skipping entry ${name}: ${String(err)}`);
    }
  }
  throw new Error(`No files found in directory: ${dir}`);
}

async function resolveVideoInput(input: VideoInput): Promise<string> {
  if (typeof input === "string") {
    try {
      const stat = statSync(input);
      if (stat.isDirectory()) return firstFileInDir(input);
    } catch (_) {
      // fall through to return input as-is; downstream ffmpeg will error if invalid
    }
    return input;
  }

  if ("path" in input) {
    return resolveVideoInput(input.path);
  }

  if ("uploadDir" in input) {
    return firstFileInDir(input.uploadDir);
  }

  const providedExt = input.filename ? extname(input.filename) : "";
  const safeExt = providedExt && /^\.[a-zA-Z0-9._-]+$/.test(providedExt) ? providedExt : ".mp4";
  const base = sanitizePathComponent(basename(input.filename ?? "upload", providedExt)) || "upload";
  mkdirSync(input.tempDir, { recursive: true });
  const filePath = resolve(input.tempDir, `${base}${safeExt}`);
  const bytes = toUint8Array(input.buffer);
  await Bun.write(filePath, bytes);
  return filePath;
}

type TranscriptSegment = { start: number; end: number; text: string };

export function mapTranscriptToWindows(
  segments: TranscriptSegment[],
  windowCount: number,
  windowSeconds: number,
) {
  const subtitles: string[] = Array.from({ length: windowCount }).map(() => "");

  for (let index = 0; index < windowCount; index++) {
    const windowStart = index * windowSeconds;
    const windowEnd = windowStart + windowSeconds;
    const matches = segments
      .filter((seg) => seg.start < windowEnd && seg.end > windowStart)
      .map((seg) => seg.text.trim())
      .filter(Boolean);
    subtitles[index] = matches.join(" ");
  }

  return subtitles;
}

async function transcribeWithWhisper(
  whisper: string,
  inputPath: string,
  outputDir: string,
  whisperArgs?: string,
): Promise<TranscriptSegment[]> {
  mkdirSync(outputDir, { recursive: true });

  const args = [
    inputPath,
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
    ...parseArgs(whisperArgs),
  ];

  logger.info("Running whisper transcription…");
  await runCommand(whisper, args);

  const jsonFiles = readdirSync(outputDir).filter((name) => name.endsWith(".json"));
  if (jsonFiles.length === 0) {
    throw new Error(`Whisper produced no .json output in ${outputDir}`);
  }

  const jsonPath = resolve(outputDir, jsonFiles[0]!);
  const raw = await Bun.file(jsonPath).text();
  const parsed: unknown = JSON.parse(raw);

  const segments =
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { segments?: unknown }).segments)
      ? ((parsed as { segments: unknown[] }).segments)
      : undefined;

  if (!segments) {
    throw new Error(`Whisper JSON did not contain a "segments" array (${jsonPath})`);
  }

  return segments
    .map((seg) => {
      const start = (seg as { start?: unknown }).start;
      const end = (seg as { end?: unknown }).end;
      const text = (seg as { text?: unknown }).text;
      if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        typeof text !== "string"
      ) {
        return null;
      }
      return { start, end, text };
    })
    .filter((seg): seg is TranscriptSegment => seg !== null);
}

export async function segmentVideo(
  input: VideoInput,
  config: SegmenterConfig,
): Promise<Segment[]> {
  await prepareSegmentDirs(config.frameDir, config.audioDir);
  const deps = await validateDependencies(config);

  const inputPath = await resolveVideoInput(input);

  const baseName = sanitizePathComponent(
    basename(inputPath, extname(inputPath)) || "video",
  );
  const frameOutDir = resolve(config.frameDir, baseName);
  rmSync(frameOutDir, { recursive: true, force: true });
  mkdirSync(frameOutDir, { recursive: true });

  const intervalSeconds = Math.max(0.001, config.segmentIntervalSeconds);
  const fps = `1/${intervalSeconds}`;

  logger.info(`Extracting frames at 1 per ${intervalSeconds}s (no audio)…`);

  const framePattern = resolve(frameOutDir, "frame-%06d.jpg");
  await runCommand(deps.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-vf",
    `fps=${fps}`,
    "-q:v",
    "2",
    "-start_number",
    "0",
    framePattern,
  ]);

  const frameFiles = readdirSync(frameOutDir)
    .filter((name) => /^frame-\d{6}\.jpg$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en"));

  if (frameFiles.length === 0) {
    logger.warn("No frames were extracted.");
    return [];
  }

  const durationSeconds = await getVideoDurationSeconds(deps.ffprobe, inputPath);
  const secondsCount = frameFiles.length;

  let subtitles: string[] = Array.from({ length: secondsCount }).map(() => "");
  if (deps.whisper) {
    const transcriptDir = resolve(frameOutDir, "transcript");
    const transcriptSegments = await transcribeWithWhisper(
      deps.whisper,
      inputPath,
      transcriptDir,
      config.whisperArgs,
    );
    subtitles = mapTranscriptToWindows(transcriptSegments, secondsCount, intervalSeconds);
  }

  logger.info(`Prepared ${secondsCount} segments from ~${durationSeconds.toFixed(2)}s`);

  return frameFiles.map((fileName, idx) => ({
    index: idx,
    start: idx * intervalSeconds,
    end: Math.min((idx + 1) * intervalSeconds, durationSeconds),
    framePath: resolve(frameOutDir, fileName),
    subtitle: subtitles[idx] ?? "",
  }));
}
