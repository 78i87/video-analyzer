import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import type { OpenRouterClient, StreamOptions } from "../src/openrouterClient";
import { runAgent, viewerTools, type AgentPersona } from "../src/agentRunner";
import type { Segment } from "../src/videoSegmenter";

type ContentWithType = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function hasTypeField(value: unknown): value is ContentWithType {
  return typeof value === "object" && value !== null && "type" in value;
}

function isImageContent(value: unknown): value is Extract<ContentWithType, { type: "image_url" }> {
  return hasTypeField(value) && value.type === "image_url";
}

function isTextContent(value: unknown): value is Extract<ContentWithType, { type: "text" }> {
  return hasTypeField(value) && value.type === "text";
}

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
    // memory context text + image
    expect(userMessage.content).toHaveLength(2);
    expect(isImageContent(userMessage.content[1])).toBe(true);
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
    // memory context text + image + subtitle text
    expect(userMessage.content).toHaveLength(3);
    expect(isImageContent(userMessage.content[1])).toBe(true);

    const thirdContent = userMessage.content[2];
    expect(isTextContent(thirdContent)).toBe(true);
    if (isTextContent(thirdContent)) {
      expect(thirdContent.text).toContain("hello world");
    }
  });

  it("parses decision_reason from function args and emits it", async () => {
    const framePath = makeTempJpeg();

    const segments: Segment[] = [
      { index: 0, start: 0, end: 1, framePath, subtitle: "" },
    ];

    let emitted: any = null;

    const client = {
      streamToolCalls: async (options: StreamOptions) => {
        // simulate model calling quit_video with JSON args
        options.callbacks?.onFunctionCall?.({
          name: "quit_video",
          arguments: JSON.stringify({ reason_for_quitting: "I am bored" }),
          raw: {},
        });
      },
    } as unknown as OpenRouterClient;

    const persona: AgentPersona = { id: "agent-1", systemPrompt: "Test persona" };
    await runAgent(persona, segments, {
      client,
      tools: viewerTools,
      events: { emit: (evt: string, payload: any) => { if (evt === 'decision') emitted = payload; return true; } },
    });

    expect(emitted).toBeDefined();
    expect(emitted.decision_reason).toBe("I am bored");
  });
});
