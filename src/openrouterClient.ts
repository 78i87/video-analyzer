export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type OpenRouterMessage = {
  type: "message";
  role: "user" | "assistant" | "tool" | "system";
  content: Array<{
    type: "input_text";
    text: string;
  } | {
    type: "input_image";
    image_url: string;
  } | {
    type: "output_text";
    text: string;
  }>;
};

export type FunctionCallEvent = {
  id?: string;
  name: string;
  arguments: string;
  callId?: string;
  raw: unknown;
};

export type StreamCallbacks = {
  onFunctionCall?: (call: FunctionCallEvent) => void;
  onArgumentsDone?: (args: string) => void;
  onEvent?: (raw: unknown) => void;
};

export type StreamOptions = {
  messages: OpenRouterMessage[];
  tools: ToolDefinition[];
  toolChoice?: "auto" | { type: "function"; function: { name: string } } | "none";
  maxOutputTokens?: number;
  signal?: AbortSignal;
  callbacks?: StreamCallbacks;
};

export class OpenRouterClient {
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    opts?: { baseUrl?: string },
  ) {
    this.baseUrl = opts?.baseUrl ?? "https://openrouter.ai";
  }

  async streamToolCalls(options: StreamOptions) {
    const body = {
      model: this.model,
      input: options.messages,
      tools: options.tools,
      tool_choice: options.toolChoice ?? "auto",
      stream: true,
      max_output_tokens: options.maxOutputTokens,
    };

    const response = await fetch(`${this.baseUrl}/api/v1/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenRouter request failed: ${response.status} ${response.statusText} - ${text}`,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("OpenRouter response had no readable body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch (err) {
          // Skip invalid JSON fragments
          continue;
        }

        options.callbacks?.onEvent?.(parsed);

        if (
          typeof parsed === "object" &&
          parsed !== null &&
          (parsed as { type?: string }).type === "response.output_item.added"
        ) {
          const item = (parsed as { item?: { type?: string; id?: string; call_id?: string; name?: string; arguments?: string } }).item;
          if (item?.type === "function_call" && item.name) {
            options.callbacks?.onFunctionCall?.({
              id: item.id,
              name: item.name,
              arguments: item.arguments ?? "",
              callId: item.call_id,
              raw: parsed,
            });
          }
        }

        if (
          typeof parsed === "object" &&
          parsed !== null &&
          (parsed as { type?: string }).type === "response.function_call_arguments.done"
        ) {
          const args = (parsed as { arguments?: string }).arguments ?? "";
          options.callbacks?.onArgumentsDone?.(args);
        }
      }
    }
  }
}
