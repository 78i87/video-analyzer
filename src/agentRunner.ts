import type { Segment } from "./videoSegmenter";
import type { OpenRouterClient, ToolDefinition } from "./openrouterClient";

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

export async function runAgent(
  _persona: AgentPersona,
  _segments: Segment[],
  _deps: AgentRunnerDeps,
): Promise<AgentRunResult> {
  // Placeholder: full streaming + tool loop will be wired next.
  return { agentId: _persona.id, stopSegmentIndex: undefined };
}
