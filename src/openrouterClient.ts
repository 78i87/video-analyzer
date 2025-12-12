export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ChatMessage = {
  role: "user" | "assistant" | "tool" | "system";
  content:
    | string
    | Array<
        | {
            type: "text";
            text: string;
          }
        | {
            type: "image_url";
            image_url: { url: string; detail?: "auto" | "high" | "low" };
          }
      >;
};

function messagesIncludeImage(messages: ChatMessage[]) {
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      if (part.type === "image_url") return true;
    }
  }
  return false;
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

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
  messages: ChatMessage[];
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
      messages: options.messages,
      tools: options.tools,
      tool_choice: options.toolChoice ?? "auto",
      stream: true,
      max_tokens: options.maxOutputTokens,
    };

    const response = await fetch(`${this.baseUrl}/api/v1/chat/completions`, {
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
      const hasImage = messagesIncludeImage(options.messages);
      const parsed = tryParseJson(text);
      const errorMessage =
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as { error?: unknown }).error === "object" &&
        (parsed as { error?: { message?: unknown } }).error !== null &&
        typeof (parsed as { error?: { message?: unknown } }).error?.message === "string"
          ? (parsed as { error: { message: string } }).error.message
          : undefined;

      if (
        response.status === 404 &&
        hasImage &&
        errorMessage &&
        errorMessage.toLowerCase().includes("support image input")
      ) {
        throw new Error(
          `OpenRouter model "${this.model}" does not support image input.\n` +
            `Set OPENROUTER_MODEL to a vision-capable model (for example: "openai/gpt-4o-mini" or "google/gemini-1.5-flash") and retry.\n\n` +
            `OpenRouter error: ${errorMessage}`,
        );
      }

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

        const choice =
          typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray((parsed as { choices?: unknown }).choices)
            ? (parsed as { choices: Array<{ delta?: unknown; finish_reason?: unknown }> }).choices[0]
            : undefined;

        const delta =
          choice &&
          typeof choice.delta === "object" &&
          choice.delta !== null
            ? (choice.delta as {
                tool_calls?: Array<{
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              })
            : undefined;

        const toolCalls = delta?.tool_calls ?? [];
        for (const toolCall of toolCalls) {
          const name = toolCall.function?.name;
          if (!name) continue;
          options.callbacks?.onFunctionCall?.({
            id: toolCall.id,
            callId: toolCall.id,
            name,
            arguments: toolCall.function?.arguments ?? "",
            raw: parsed,
          });
        }

        const finishReason =
          choice && typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
        if (finishReason === "tool_calls") {
          const args = toolCalls.map((t) => t.function?.arguments ?? "").join("");
          options.callbacks?.onArgumentsDone?.(args);
        }
      }
    }
  }
}
