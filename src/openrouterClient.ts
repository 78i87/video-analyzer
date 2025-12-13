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
  onTextDelta?: (text: string, raw: unknown) => void;
  onFinish?: (finishReason: string | undefined, raw: unknown) => void;
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
    let eventCount = 0;
    let contentDeltaCount = 0;
    let toolCallDeltaCount = 0;
    let finishReasonSeen: string | undefined;
    let loggedFirstToolCall = false;
    const partialToolCalls: Record<
      number,
      { id?: string; name?: string; args: string; emitted: boolean }
    > = {};

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
                content?: unknown;
                tool_calls?: Array<{
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
                function_call?: unknown;
              })
            : undefined;
        const choiceObj =
          choice && typeof choice === "object" && choice !== null ? (choice as Record<string, unknown>) : undefined;

        eventCount += 1;

        const contentDelta = typeof delta?.content === "string" ? delta.content : undefined;
        if (contentDelta) {
          contentDeltaCount += 1;
          options.callbacks?.onTextDelta?.(contentDelta, parsed);
        }

        const toolCalls = delta?.tool_calls ?? [];
        if (toolCalls.length > 0) toolCallDeltaCount += 1;
        for (const toolCall of toolCalls) {
          // Some providers stream tool calls in pieces (args before name). We accumulate by index.
          const toolCallObj =
            typeof toolCall === "object" && toolCall !== null
              ? (toolCall as Record<string, unknown>)
              : undefined;
          const functionObj =
            toolCallObj && typeof toolCallObj.function === "object" && toolCallObj.function !== null
              ? (toolCallObj.function as Record<string, unknown>)
              : undefined;
          const idx = typeof toolCallObj?.index === "number" ? (toolCallObj.index as number) : 0;
          const chunkArgs = typeof functionObj?.arguments === "string" ? (functionObj.arguments as string) : "";
          const chunkName =
            typeof functionObj?.name === "string"
              ? (functionObj.name as string)
              : typeof toolCallObj?.name === "string"
                ? (toolCallObj.name as string)
                : undefined;
          const prev = partialToolCalls[idx] ?? { args: "", emitted: false };
          const merged = {
            id: (typeof toolCallObj?.id === "string" ? (toolCallObj.id as string) : undefined) ?? prev.id,
            name: chunkName ?? prev.name,
            args: prev.args + chunkArgs,
            emitted: prev.emitted,
          };
          partialToolCalls[idx] = merged;

          // Fallback path: if name is missing in this delta but we can recover it (from earlier deltas or from args),
          // emit the tool call now so the caller doesn't treat it as "no tool calls".
          if (!toolCall.function?.name && !merged.emitted) {
            let recoveredName = merged.name;
            if (!recoveredName) {
              const parsedArgs = tryParseJson(merged.args);
              if (parsedArgs && typeof parsedArgs === "object" && parsedArgs !== null) {
                const maybeName = (parsedArgs as { name?: unknown }).name;
                const maybeTool = (parsedArgs as { tool?: unknown }).tool;
                if (typeof maybeName === "string") recoveredName = maybeName;
                else if (typeof maybeTool === "string") recoveredName = maybeTool;
              }
            }
            if (recoveredName) {
              merged.emitted = true;
              merged.name = recoveredName;
              partialToolCalls[idx] = merged;
              options.callbacks?.onFunctionCall?.({
                id: merged.id,
                callId: merged.id,
                name: recoveredName,
                arguments: merged.args,
                raw: parsed,
              });
              continue;
            }
          }

          const name = toolCall.function?.name;
          if (!name) {
            continue;
          }
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
        if (finishReason) {
          finishReasonSeen = finishReason;
          options.callbacks?.onFinish?.(finishReason, parsed);
        }

        if (finishReason === "tool_calls") {
          const args = toolCalls.map((t) => t.function?.arguments ?? "").join("");
          options.callbacks?.onArgumentsDone?.(args);
        }
      }
    }

    if (!finishReasonSeen) {
      // no-op
    }
  }
}
