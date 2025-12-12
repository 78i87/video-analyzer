import { describe, expect, test } from "bun:test";
import { resolveVideoPathArg } from "../src/cliArgs";

describe("resolveVideoPathArg", () => {
  test("returns usage when no args", () => {
    const result = resolveVideoPathArg([], () => false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("Usage:");
  });

  test("uses single arg as-is", () => {
    const result = resolveVideoPathArg(["/tmp/video.mp4"], () => false);
    expect(result).toEqual({ ok: true, videoPath: "/tmp/video.mp4" });
  });

  test("joins multiple args when joined path exists", () => {
    const result = resolveVideoPathArg(
      ["/Volumes/2TB/video", "analyzer/123.mp4"],
      (path) => path === "/Volumes/2TB/video analyzer/123.mp4",
    );
    expect(result).toEqual({
      ok: true,
      videoPath: "/Volumes/2TB/video analyzer/123.mp4",
    });
  });

  test("errors with quoting hint when extra args don't form a path", () => {
    const result = resolveVideoPathArg(["a.mp4", "extra"], () => false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("quote it");
  });
});

