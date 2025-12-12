import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("creates frame/audio dirs under provided cwd", () => {
    const originalEnv = { ...process.env };
    try {
      const cwd = mkdtempSync(join(tmpdir(), "video-analyzer-"));
      process.env.OPENROUTER_API_KEY = "test-key";
      process.env.FRAME_DIR = "frames";
      process.env.AUDIO_DIR = "audio";

      const config = loadConfig(cwd);

      expect(existsSync(config.frameDir)).toBe(true);
      expect(existsSync(config.audioDir)).toBe(true);
    } finally {
      process.env = originalEnv;
    }
  });
});
