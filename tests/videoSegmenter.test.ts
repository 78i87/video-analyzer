import { describe, expect, it } from "bun:test";
import {
  MissingBinaryError,
  mapTranscriptToWindows,
  validateDependencies,
} from "../src/videoSegmenter";

describe("validateDependencies", () => {
  it("accepts binaries that exist in PATH", async () => {
    await expect(
      validateDependencies({
        ffmpegBin: "true",
        ffprobeBin: "true",
        frameDir: "data/frames",
        audioDir: "data/audio",
        segmentIntervalSeconds: 8,
      }),
    ).resolves.toMatchObject({ ffmpeg: expect.any(String), ffprobe: expect.any(String) });
  });

  it("throws MissingBinaryError when ffmpeg missing", async () => {
    await expect(
      validateDependencies({
        ffmpegBin: "definitely-not-a-real-binary",
        ffprobeBin: "true",
        frameDir: "data/frames",
        audioDir: "data/audio",
        segmentIntervalSeconds: 8,
      }),
    ).rejects.toBeInstanceOf(MissingBinaryError);
  });
});

describe("mapTranscriptToWindows", () => {
  it("maps overlapping transcript segments to per-second subtitles", () => {
    const subtitles = mapTranscriptToWindows(
      [
        { start: 0.2, end: 1.8, text: "hello" },
        { start: 1.1, end: 2.2, text: "world" },
      ],
      4,
      1,
    );
    expect(subtitles).toEqual(["hello", "hello world", "world", ""]);
  });
});
