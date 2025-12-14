import type { Segment } from "./videoSegmenter";
import type { ChatMessage, OpenRouterClient, ToolDefinition } from "./openrouterClient";
import type { AgentOutputRecorder } from "./agentOutputRecorder";
import { logger } from "./logger";
import { Buffer } from "node:buffer";
import type { EventEmitter } from "node:events";

export type AgentToolName = "keep_playing" | "quit_video";

export type AgentState = {
  firstQuitSeen: boolean;
  stopped: boolean;
  stopSegmentIndex?: number;
  status: "watching" | "probation" | "stopped";
};

export type DoubleQuitDecision = {
  coercedTool: AgentToolName;
  decision: "continue" | "stop";
  state: AgentState;
};

export const initialAgentState = (): AgentState => ({
  firstQuitSeen: false,
  stopped: false,
  status: "watching",
});

export function applyDoubleQuitRule(
  state: AgentState,
  tool: AgentToolName,
  segmentIndex: number,
): DoubleQuitDecision {
  if (tool === "quit_video") {
    if (!state.firstQuitSeen) {
      const nextState: AgentState = {
        ...state,
        firstQuitSeen: true,
        status: "probation",
      };
      return {
        coercedTool: "keep_playing",
        decision: "continue",
        state: nextState,
      };
    }

    const nextState: AgentState = {
      ...state,
      stopped: true,
      stopSegmentIndex: segmentIndex,
      status: "stopped",
    };
    return {
      coercedTool: "quit_video",
      decision: "stop",
      state: nextState,
    };
  }

  return {
    coercedTool: "keep_playing",
    decision: "continue",
    state,
  };
}

export type AgentRunResult = {
  agentId: string;
  stopSegmentIndex?: number;
};

export type AgentPersona = {
  id: string;
  systemPrompt: string;
};

export type AgentRunnerDeps = {
  client: OpenRouterClient;
  tools: ToolDefinition[];
  logModelOutput?: boolean;
  outputRecorder?: AgentOutputRecorder;
  runId?: string;
  reporter?: AgentRunReporter;
  suppressSegmentLogs?: boolean;
  events?: Pick<EventEmitter, "emit">;
};

export const viewerTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "keep_playing",
      description: "Viewer keeps watching the video.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quit_video",
      description: "Viewer quits (stops watching) the video.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
  },
];

async function readJpegDataUrl(filePath: string): Promise<string> {
  const bytes = await Bun.file(filePath).arrayBuffer();
  const base64 = Buffer.from(bytes).toString("base64");
  return `data:image/jpeg;base64,${base64}`;
}

export type AgentRunReporter = {
  onSegment?: (update: {
    agentId: string;
    segment: Segment;
    tool: AgentToolName;
    decision: DoubleQuitDecision["decision"];
    state: AgentState;
  }) => void;
  onDone?: (result: AgentRunResult) => void;
};

export async function runAgent(
  persona: AgentPersona,
  segments: Segment[],
  deps: AgentRunnerDeps,
): Promise<AgentRunResult> {
  if (segments.length === 0) {
    return { agentId: persona.id, stopSegmentIndex: undefined };
  }

  if (deps.tools.length === 0) {
    logger.warn(`No tools provided; skipping OpenRouter calls for ${persona.id}`);
    return { agentId: persona.id, stopSegmentIndex: undefined };
  }

  let state = initialAgentState();

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const imageUrl = await readJpegDataUrl(segment.framePath);
    const maxOutputTokens = 256;

    const logModelOutput = deps.logModelOutput ?? false;
    const input: ChatMessage[] = [
      {
        role: "system" as const,
        content:
          `${persona.systemPrompt}\n\n` +
          "You will be shown 1 FPS video frames. " +
          "If a subtitle/transcript is provided, you may use it. " +
          'After each frame, call exactly one tool: "keep_playing" or "quit_video". ' +
          "Do not output any text or reasoning; only call the tool.",
      },
      {
        role: "user" as const,
        content: [
          { type: "image_url" as const, image_url: { url: imageUrl } },
          ...(segment.subtitle.trim()
            ? [
                {
                  type: "text" as const,
                  text: `Subtitle: ${segment.subtitle.trim()}`,
                },
              ]
            : []),
        ],
      },
    ];

    const controller = new AbortController();
    let tool: AgentToolName | undefined;
    let assistantText = "";
    let finishReason: string | undefined;
    let sawToolCallDelta = false;

    try {
      await deps.client.streamToolCalls({
        messages: input,
        tools: deps.tools,
        toolChoice: "auto",
        maxOutputTokens,
        signal: controller.signal,
        callbacks: {
          onFunctionCall: (call) => {
            if (call.name === "keep_playing" || call.name === "quit_video") {
              tool = call.name;
              controller.abort();
            }
          },
          onTextDelta: (text) => {
            assistantText += text;
          },
          onFinish: (reason) => {
            finishReason = reason;
          },
          onEvent: (raw) => {
            if (!logModelOutput) return;
            const parsed =
              typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
            const choices = parsed && Array.isArray(parsed.choices) ? parsed.choices : undefined;
            const choice =
              choices && choices.length > 0 && typeof choices[0] === "object" && choices[0] !== null
                ? (choices[0] as Record<string, unknown>)
                : undefined;
            const delta =
              choice && typeof choice.delta === "object" && choice.delta !== null
                ? (choice.delta as Record<string, unknown>)
                : undefined;
            const toolCalls = delta && Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
            if (toolCalls.length > 0) sawToolCallDelta = true;
          },
        },
      });
    } catch (err) {
      if (!tool) throw err;
    }

    if (!tool) {
      const text = assistantText.trim();
      const inferred =
        /"quit_video"\b/.test(text) || /\bquit_video\b/.test(text) ? ("quit_video" as const)
        : /"keep_playing"\b/.test(text) || /\bkeep_playing\b/.test(text) ? ("keep_playing" as const)
        : /quit\b/i.test(text) ? ("quit_video" as const)
        : /keep\b/i.test(text) ? ("keep_playing" as const)
        : undefined;

      // If we couldn't parse a tool call, fall back deterministically so the simulation can proceed.
      if (inferred) tool = inferred;
      else tool = "keep_playing";
    }

    if (logModelOutput) {
      logger.info(
        `[${persona.id}] segment=${segment.index} finish=${finishReason ?? "(unknown)"} ` +
          `tool=${tool ?? "(none)"} tool_calls_delta=${sawToolCallDelta ? "yes" : "no"} ` +
          `assistant_text=${JSON.stringify(assistantText.trim())}`,
      );
    }

    if (!tool) {
      const textSnippet = assistantText.trim().slice(0, 500);
      throw new Error(
        `Model did not call a tool for ${persona.id} on segment ${segment.index}. ` +
          `finish_reason=${finishReason ?? "(unknown)"} ` +
          `assistant_text=${textSnippet ? JSON.stringify(textSnippet) : "(empty)"}\n\n` +
          `This usually means the selected model does not support tool calling. ` +
          `Try a different vision model in OPENROUTER_MODEL.`,
      );
    }

    const result = applyDoubleQuitRule(state, tool, segment.index);
    state = result.state;

    deps.events?.emit("decision", {
      agentId: persona.id,
      segment,
      tool,
      decision: result.decision,
      state,
    });

    const runId = deps.runId;
    if (runId && deps.outputRecorder) {
      void deps.outputRecorder
        .record({
          type: "segment",
          ts: new Date().toISOString(),
          runId,
          agentId: persona.id,
          segmentIndex: segment.index,
          framePath: segment.framePath,
          subtitle: segment.subtitle,
          modelTool: tool,
          coercedTool: result.coercedTool,
          decision: result.decision,
          finishReason: finishReason ?? null,
          assistantText: assistantText,
          sawToolCallDelta,
        })
        .catch((err) => {
          logger.warn(
            `Failed to write agent output log for ${persona.id} segment=${segment.index}: ${String(err)}`,
          );
        });
    }

    deps.reporter?.onSegment?.({
      agentId: persona.id,
      segment,
      tool,
      decision: result.decision,
      state,
    });

    if (!deps.suppressSegmentLogs) {
      logger.debug(
        `[${persona.id}] segment=${segment.index} tool=${tool} decision=${result.decision}`,
      );
    }

    if (result.decision === "stop") {
      deps.events?.emit("stop", {
        agentId: persona.id,
        stopSegmentIndex: state.stopSegmentIndex,
        state,
      });

      const finalResult = { agentId: persona.id, stopSegmentIndex: state.stopSegmentIndex };
      deps.reporter?.onDone?.(finalResult);
      return finalResult;
    }
  }

  const finalResult = { agentId: persona.id, stopSegmentIndex: undefined };
  deps.reporter?.onDone?.(finalResult);
  return finalResult;
}
