import { describe, expect, it } from "bun:test";
import { OpenRouterClient, type StreamOptions } from "../src/openrouterClient";

describe("OpenRouterClient error handling", () => {
  it("explains when a model does not support image input", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            error: { message: "No endpoints found that support image input", code: 404 },
          }),
          { status: 404, statusText: "Not Found" },
        );

      const client = new OpenRouterClient("test-key", "mistralai/test-model", {
        baseUrl: "https://openrouter.ai",
      });

      const options: StreamOptions = {
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "data:image/jpeg;base64,AA==" } },
            ],
          },
        ],
        tools: [],
      };

      await expect(client.streamToolCalls(options)).rejects.toThrow(
        /does not support image input/i,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("OpenRouterClient streaming callbacks", () => {
  it("emits text deltas and finish reason", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        const encoder = new TextEncoder();
        const chunks = [
          'data: {"choices":[{"delta":{"content":"hello "}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n",
        ];

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        });

        return new Response(stream, { status: 200 });
      };

      const client = new OpenRouterClient("test-key", "test-model", {
        baseUrl: "https://openrouter.ai",
      });

      let text = "";
      let finishReason: string | undefined;

      const options: StreamOptions = {
        messages: [{ role: "user", content: "Hi" }],
        tools: [],
        callbacks: {
          onTextDelta: (delta) => {
            text += delta;
          },
          onFinish: (reason) => {
            finishReason = reason;
          },
        },
      };

      await client.streamToolCalls(options);
      expect(text).toBe("hello world");
      expect(finishReason).toBe("stop");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
