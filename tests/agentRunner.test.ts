import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import type { OpenRouterClient, StreamOptions } from "../src/openrouterClient";
import { runAgent, viewerTools, type AgentPersona } from "../src/agentRunner";
import type { Segment } from "../src/videoSegmenter";

function makeTempJpeg(): string {
  const dir = mkdtempSync(join(tmpdir(), "video-analyzer-"));
  const filePath = join(dir, "frame.jpg");
  writeFileSync(filePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // minimal JPEG SOI/EOI
  return filePath;
}

describe("runAgent message inputs", () => {
  it("sends image-only when subtitle is empty", async () => {
    const framePath = makeTempJpeg();

    const segments: Segment[] = [
      { index: 0, start: 0, end: 1, framePath, subtitle: "" },
    ];

    let lastOptions: StreamOptions | undefined;

    const client = {
      streamToolCalls: async (options: StreamOptions) => {
        lastOptions = options;
        options.callbacks?.onFunctionCall?.({
          name: "keep_playing",
          arguments: "{}",
          raw: {},
        });
      },
    } as unknown as OpenRouterClient;

    const persona: AgentPersona = { id: "agent-1", systemPrompt: "Test persona" };
    await runAgent(persona, segments, { client, tools: viewerTools });

    expect(lastOptions).toBeDefined();
    const userMessage = lastOptions!.messages.find((m) => m.role === "user")!;
    expect(userMessage.content).toHaveLength(1);
    expect(userMessage.content[0]!.type).toBe("input_image");
  });

  it("adds subtitle text when present", async () => {
    const framePath = makeTempJpeg();

    const segments: Segment[] = [
      { index: 0, start: 0, end: 1, framePath, subtitle: "hello world" },
    ];

    let lastOptions: StreamOptions | undefined;

    const client = {
      streamToolCalls: async (options: StreamOptions) => {
        lastOptions = options;
        options.callbacks?.onFunctionCall?.({
          name: "keep_playing",
          arguments: "{}",
          raw: {},
        });
      },
    } as unknown as OpenRouterClient;

    const persona: AgentPersona = { id: "agent-1", systemPrompt: "Test persona" };
    await runAgent(persona, segments, { client, tools: viewerTools });

    expect(lastOptions).toBeDefined();
    const userMessage = lastOptions!.messages.find((m) => m.role === "user")!;
    expect(userMessage.content[0]!.type).toBe("input_image");
    expect(userMessage.content[1]!.type).toBe("input_text");
    expect((userMessage.content[1] as { type: "input_text"; text: string }).text).toContain(
      "hello world",
    );
  });
});
