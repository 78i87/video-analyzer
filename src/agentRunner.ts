import type { Segment } from "./videoSegmenter";
import type { OpenRouterClient, ToolDefinition } from "./openrouterClient";
import { logger } from "./logger";
import { Buffer } from "node:buffer";

export type AgentToolName = "keep_playing" | "quit_video";

export type AgentState = {
  firstQuitSeen: boolean;
  stopped: boolean;
  stopSegmentIndex?: number;
};

export type DoubleQuitDecision = {
  coercedTool: AgentToolName;
  decision: "continue" | "stop";
  state: AgentState;
};

export const initialAgentState = (): AgentState => ({
  firstQuitSeen: false,
  stopped: false,
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

    const input = [
      {
        type: "message" as const,
        role: "system" as const,
        content: [
          {
            type: "input_text" as const,
            text:
              `${persona.systemPrompt}\n\n` +
              "You will be shown 1 FPS video frames. " +
              "If a subtitle/transcript is provided, you may use it. " +
              'After each frame, call exactly one tool: "keep_playing" or "quit_video".',
          },
        ],
      },
      {
        type: "message" as const,
        role: "user" as const,
        content: [
          { type: "input_image" as const, image_url: imageUrl },
          ...(segment.subtitle.trim()
            ? [
                {
                  type: "input_text" as const,
                  text: `Subtitle: ${segment.subtitle.trim()}`,
                },
              ]
            : []),
        ],
      },
    ];

    const controller = new AbortController();
    let tool: AgentToolName | undefined;

    try {
      await deps.client.streamToolCalls({
        messages: input,
        tools: deps.tools,
        toolChoice: "auto",
        maxOutputTokens: 64,
        signal: controller.signal,
        callbacks: {
          onFunctionCall: (call) => {
            if (call.name === "keep_playing" || call.name === "quit_video") {
              tool = call.name;
              controller.abort();
            }
          },
        },
      });
    } catch (err) {
      if (!tool) throw err;
    }

    if (!tool) {
      throw new Error(
        `Model did not call a tool for ${persona.id} on segment ${segment.index}`,
      );
    }

    const result = applyDoubleQuitRule(state, tool, segment.index);
    state = result.state;

    logger.debug(
      `[${persona.id}] segment=${segment.index} tool=${tool} decision=${result.decision}`,
    );

    if (result.decision === "stop") {
      return { agentId: persona.id, stopSegmentIndex: state.stopSegmentIndex };
    }
  }

  return { agentId: persona.id, stopSegmentIndex: undefined };
}
