import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentOutputRecorder } from "../src/agentOutputRecorder";

describe("createAgentOutputRecorder", () => {
  it("writes valid JSONL records sequentially", async () => {
    const dir = mkdtempSync(join(tmpdir(), "video-analyzer-recorder-"));
    const path = join(dir, "out.jsonl");
    const recorder = await createAgentOutputRecorder(path);

    await recorder.record({
      type: "run_start",
      ts: "2025-01-01T00:00:00.000Z",
      runId: "run-1",
      videoPath: "/tmp/test.mp4",
      model: "test/model",
      agentCount: 2,
      segmentIntervalSeconds: 1,
    });

    await Promise.all(
      Array.from({ length: 20 }).map((_, idx) =>
        recorder.record({
          type: "segment",
          ts: "2025-01-01T00:00:00.000Z",
          runId: "run-1",
          agentId: "agent-1",
          segmentIndex: idx,
          framePath: `/tmp/frame-${idx}.jpg`,
          subtitle: "",
          modelTool: "keep_playing",
          coercedTool: "keep_playing",
          decision: "continue",
          finishReason: "tool_calls",
          assistantText: "",
          sawToolCallDelta: true,
        }),
      ),
    );

    await recorder.record({
      type: "run_end",
      ts: "2025-01-01T00:00:01.000Z",
      runId: "run-1",
      stopCounts: { full: 2 },
    });

    await recorder.flush();

    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(22);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

