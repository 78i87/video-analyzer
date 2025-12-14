import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type AgentOutputRecord =
  | {
      type: "run_start";
      ts: string;
      runId: string;
      videoPath: string;
      model: string;
      agentCount: number;
      segmentIntervalSeconds: number;
    }
  | {
      type: "segment";
      ts: string;
      runId: string;
      agentId: string;
      segmentIndex: number;
      framePath: string;
      subtitle: string;
      modelTool: string;
      coercedTool: string;
      model_used?: string | null;
      decision: "continue" | "stop";
      finishReason: string | null;
      assistantText: string;
      sawToolCallDelta: boolean;
      decision_reason?: string | null;
      subconscious_thought?: string | null;
      curiosity_level?: number | null;
      raw_assistant_text?: string | null;
      raw_function_args?: string | null;
    }
  | {
      type: "run_end";
      ts: string;
      runId: string;
      stopCounts: Record<string, number>;
    }
  | {
      type: "error";
      ts: string;
      runId: string;
      message: string;
      stack?: string;
    };

export type AgentOutputRecorder = {
  path: string;
  record: (record: AgentOutputRecord) => Promise<void>;
  flush: () => Promise<void>;
};

export async function createAgentOutputRecorder(filePath: string): Promise<AgentOutputRecorder> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, "", "utf8");

  let chain = Promise.resolve();

  function record(record: AgentOutputRecord) {
    const line = `${JSON.stringify(record)}\n`;
    chain = chain.then(() => appendFile(filePath, line, "utf8"));
    return chain;
  }

  function flush() {
    return chain;
  }

  return { path: filePath, record, flush };
}

