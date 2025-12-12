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

