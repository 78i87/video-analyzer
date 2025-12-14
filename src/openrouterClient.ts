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
  onModelSelected?: (model: string, attempt: number, status?: number) => void;
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
  private readonly models: string[];
  private readonly maxAttempts: number;

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    opts?: { baseUrl?: string; fallbackModels?: string[]; maxAttempts?: number },
  ) {
    this.baseUrl = opts?.baseUrl ?? "https://openrouter.ai";
    this.models = [model, ...(opts?.fallbackModels ?? [])].filter(Boolean);
    this.maxAttempts = opts?.maxAttempts ?? this.models.length;
  }

  private async sleepWithAbort(ms: number, signal?: AbortSignal) {
    if (!ms) return;
    return new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(t);
        reject(new Error("aborted"));
      }
      signal?.addEventListener("abort", onAbort);
    });
  }

  async streamToolCalls(options: StreamOptions) {
    const hasImage = messagesIncludeImage(options.messages);

    const baseDelay = 1000;

    for (let attempt = 0; attempt < Math.min(this.maxAttempts, this.models.length); attempt++) {
      const model = this.models[attempt];
      options.callbacks?.onModelSelected?.(model, attempt + 1);

      const body = {
        model,
        messages: options.messages,
        tools: options.tools,
        tool_choice: options.toolChoice ?? "auto",
        stream: true,
        max_tokens: options.maxOutputTokens,
      };

      try {
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
          const parsed = tryParseJson(text);
          const errorMessage =
            typeof parsed === "object" &&
            parsed !== null &&
            typeof (parsed as { error?: unknown }).error === "object" &&
            (parsed as { error?: { message?: unknown } }).error !== null &&
            typeof (parsed as { error?: { message?: unknown } }).error?.message === "string"
              ? (parsed as { error: { message: string } }).error.message
              : undefined;

          // Image-not-supported is treated as unrecoverable for this model
          if (response.status === 404 && hasImage && errorMessage && errorMessage.toLowerCase().includes("support image input")) {
            throw new Error(
              `OpenRouter model "${model}" does not support image input.\nOpenRouter error: ${errorMessage}`,
            );
          }

          // Retryable: 429 Too Many Requests or 5xx Server Errors
          if (response.status === 429 || response.status >= 500) {
            options.callbacks?.onModelSelected?.(model, attempt + 1, response.status);
            const isLast = attempt + 1 >= Math.min(this.maxAttempts, this.models.length);
            if (isLast) {
              throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText} - ${text}`);
            }
            // backoff with jitter
            const delay = Math.round(baseDelay * Math.pow(2, attempt) * (0.8 + Math.random() * 0.4));
            await this.sleepWithAbort(delay, options.signal);
            continue; // try next model
          }

          // Non-retryable error: bubble up
          throw new Error(`OpenRouter request failed: ${response.status} ${response.statusText} - ${text}`);
        }

        // Successful response: stream processing
        options.callbacks?.onModelSelected?.(model, attempt + 1, response.status);

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("OpenRouter response had no readable body");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let finishReasonSeen: string | undefined;
        const partialToolCalls: Record<number, { id?: string; name?: string; args: string; emitted: boolean }> = {};

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
            } catch {
              continue;
            }

            options.callbacks?.onEvent?.(parsed);

            const choice =
              typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { choices?: unknown }).choices)
                ? (parsed as { choices: Array<{ delta?: unknown; finish_reason?: unknown }> }).choices[0]
                : undefined;

            const delta =
              choice && typeof choice.delta === "object" && choice.delta !== null
                ? (choice.delta as { content?: unknown; tool_calls?: Array<unknown>; function_call?: unknown })
                : undefined;

            const contentDelta = typeof delta?.content === "string" ? delta.content : undefined;
            if (contentDelta) {
              options.callbacks?.onTextDelta?.(contentDelta, parsed);
            }

            const toolCalls = (delta as any)?.tool_calls ?? [];
            for (const toolCall of toolCalls as any[]) {
              const toolCallObj = typeof toolCall === "object" && toolCall !== null ? (toolCall as Record<string, unknown>) : undefined;
              const functionObj = toolCallObj && typeof toolCallObj.function === "object" ? (toolCallObj.function as Record<string, unknown>) : undefined;
              const idx = typeof toolCallObj?.index === "number" ? (toolCallObj.index as number) : 0;
              const chunkArgs = typeof functionObj?.arguments === "string" ? (functionObj.arguments as string) : "";
              const chunkName = typeof functionObj?.name === "string" ? (functionObj.name as string) : typeof toolCallObj?.name === "string" ? (toolCallObj.name as string) : undefined;
              const prev = partialToolCalls[idx] ?? { args: "", emitted: false };
              const merged = {
                id: (typeof toolCallObj?.id === "string" ? (toolCallObj.id as string) : undefined) ?? prev.id,
                name: chunkName ?? prev.name,
                args: prev.args + chunkArgs,
                emitted: prev.emitted,
              };
              partialToolCalls[idx] = merged;

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
                  options.callbacks?.onFunctionCall?.({ id: merged.id, callId: merged.id, name: recoveredName, arguments: merged.args, raw: parsed });
                  continue;
                }
              }

              const name = toolCall.function?.name as string | undefined;
              if (!name) continue;
              options.callbacks?.onFunctionCall?.({ id: toolCall.id, callId: toolCall.id, name, arguments: toolCall.function?.arguments ?? "", raw: parsed });
            }

            const finishReason = choice && typeof choice.finish_reason === "string" ? choice.finish_reason : undefined;
            if (finishReason) {
              finishReasonSeen = finishReason;
              options.callbacks?.onFinish?.(finishReason, parsed);
            }

            if (finishReason === "tool_calls") {
              const args = (toolCalls as any[]).map((t) => (t as any).function?.arguments ?? "").join("");
              options.callbacks?.onArgumentsDone?.(args);
            }
          }
        }

        // stream finished normally
        return;
      } catch (err: unknown) {
        // If the operation was aborted, propagate immediately
        const isAbort =
          (err instanceof Error && (err.name === "AbortError" || err.message?.toLowerCase().includes("aborted"))) ||
          options.signal?.aborted === true;
        if (isAbort) throw err as any;

        // Treat other errors (network, TLS, stream errors) as retryable and try next model
        options.callbacks?.onModelSelected?.(model, attempt + 1, undefined);
        const isLast = attempt + 1 >= Math.min(this.maxAttempts, this.models.length);
        if (isLast) {
          throw new Error(
            `OpenRouter request failed for model "${model}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }

        const delay = Math.round(baseDelay * Math.pow(2, attempt) * (0.8 + Math.random() * 0.4));
        await this.sleepWithAbort(delay, options.signal);
        continue; // try next model
      }
    }

    // If we exhausted models without success, throw a generic error
    throw new Error("OpenRouter: all models failed or were exhausted");
  }
}
