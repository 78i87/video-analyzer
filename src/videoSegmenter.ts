import { access } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

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
  frameDir: string;
  audioDir: string;
  segmentIntervalSeconds: number;
};

export class MissingBinaryError extends Error {
  constructor(binaryName: string, envKey: string) {
    super(
      `Required binary "${binaryName}" was not found in PATH. Set ${envKey} to the full path or install the tool.`,
    );
    this.name = "MissingBinaryError";
  }
}

async function assertExecutable(binary: string, envKey: string) {
  const located = await Bun.which(binary);
  if (!located) {
    throw new MissingBinaryError(binary, envKey);
  }
  await access(located);
  return located;
}

export async function prepareSegmentDirs(frameDir: string, audioDir: string) {
  mkdirSync(frameDir, { recursive: true });
  mkdirSync(audioDir, { recursive: true });
}

export async function validateDependencies(config: SegmenterConfig) {
  await assertExecutable(config.ffmpegBin, "FFMPEG_BIN");
  await assertExecutable(config.ffprobeBin, "FFMPEG_PROBE_BIN");
  if (config.whisperBin) {
    await assertExecutable(config.whisperBin, "WHISPER_BIN");
  }
}

export async function segmentVideo(
  inputPath: string,
  config: SegmenterConfig,
): Promise<Segment[]> {
  await prepareSegmentDirs(config.frameDir, config.audioDir);
  await validateDependencies(config);

  // Placeholder: real implementation will invoke ffprobe, ffmpeg, and whisper
  // to produce time-aligned segments. Returning an empty list keeps the CLI
  // usable for now while the segmentation pipeline is implemented.
  return [];
}

export function buildSegmentPaths(
  baseDir: string,
  index: number,
  kind: "frame" | "audio",
) {
  const fileName = kind === "frame" ? `frame-${index}.jpg` : `audio-${index}.wav`;
  return resolve(baseDir, fileName);
}
