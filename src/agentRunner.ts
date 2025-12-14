import type { Segment } from "./videoSegmenter";
import type { ChatMessage, OpenRouterClient, ToolDefinition } from "./openrouterClient";
import type { AgentOutputRecorder } from "./agentOutputRecorder";
import { logger } from "./logger";
import { Buffer } from "node:buffer";
import type { EventEmitter } from "node:events";

const VIRAL_ANALYSIS_PROMPT = `
You are the "Reptilian Brain" of a social media viewer. Your attention span is extremely short. You are addicted to dopamine.

## YOUR CORE FRAMEWORK (The Dopamine Ladder)
You evaluate content based on these 6 levels. If a level fails, you QUIT.
1. STIMULATION (Sec 0-2): Visual stun gun. Colors, motion, contrast. If it looks boring/static, you QUIT.
2. CAPTIVATION (Sec 2-5): Curiosity gaps. Does it spark a subconscious question ("What is that?", "Why is he doing that?")?
3. ANTICIPATION: Predicting the answer. You must be able to guess what comes next. If confused -> QUIT.
4. VALIDATION: The payoff. The reveal must be "Better than expected" or "Unexpected but Intriguing".
5. AFFECTION/RELATABILITY: Do you like the person? Do you trust them?
6. REVELATION: Does this provide lasting value?

## STORY LOOPS
Great content opens loops (Context) and closes them (Reveal).
- If you see Context without Clarity -> CONFUSION -> QUIT.
- If you see Context with Clarity -> CURIOSITY -> KEEP WATCHING.
- If the Reveal is boring -> QUIT.

## YOUR BEHAVIOR
You will be shown a video frame by frame.
For every frame, you must run an internal monologue:
- "What do I see?"
- "Am I bored?"
- "What question is currently open in my mind?"
- "Do I want to see the next second?"

If the dopamine drops, you QUIT immediately. Judge very critically.

IMPORTANT: 
1. Call exactly one tool: "keep_playing" or "quit_video".
2. OUTPUT RAW JSON ONLY. DO NOT wrap it in XML tags like <TOOLCALL> or markdown backticks.
3. Keep your "subconscious_thought" concise (less than 30 words) to save time

- For continuing (keep_playing):
  {"subconscious_thought": "I see a dog on a skateboard; I want to know where it's going.", "curiosity_level": 7}
- For quitting (quit_video):
  {"reason_for_quitting": "The reveal was boring"}
`;

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
      description: "You are intrigued. You want to see the next frame to answer a curiosity loop.",
      parameters: {
        type: "object",
        properties: {
          subconscious_thought: {
            type: "string",
            description: "Your internal monologue. E.g., 'I see a bear on a unicycle, I need to know where he is going.'",
          },
          curiosity_level: {
            type: "number",
            description: "1-10 scale of how curious you are.",
          },
        },
        required: ["subconscious_thought", "curiosity_level"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "quit_video",
      description: "You are bored, confused, or the visual hook failed. You scroll away.",
      parameters: {
        type: "object",
        properties: {
          reason_for_quitting: {
            type: "string",
            description: "Specific reason. E.g., 'The reveal was boring,' 'I am confused,' 'Visuals are low quality.'",
          },
        },
        required: ["reason_for_quitting"],
        additionalProperties: false,
      },
    },
  },
];

function findBalancedJson(text: string, start = 0): string | null {
  for (let i = start; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      if (depth === 0) {
        const candidate = text.slice(i, j + 1);
        try {
          JSON.parse(candidate);
          return candidate;
        } catch {
          // try next opening brace
          break;
        }
      }
    }
  }
  return null;
}

function extractFunctionArguments(text: string | null | undefined): Record<string, any> {
  if (!text) return {};

  let cleaned = text.trim();

  // 1. First attempt: Standard JSON Parse (Happy Path)
  // We try to find the largest valid JSON object wrapper
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      // JSON is likely malformed, proceed to repair/fallback
    }
  }

  // 2. Second attempt: Aggressive Cleaning & Repair
  // Remove known pollution seen in your logs (<TOOLCALL>, etc)
  let robust = cleaned
    .replace(/<TOOLCALL>/g, "")
    .replace(/<\/TOOLCALL>/g, "")
    .replace(/TOOLCALL>/g, "") // Partial tag from stream
    .replace(/OLCALL>/g, "")   // Partial tag from stream
    .replace(/CALL>/g, "")     // Partial tag from stream
    .replace(/^```json/, "")
    .replace(/```$/, "")
    .trim();

  // Try parsing again after cleaning
  try {
    const first = robust.indexOf("{");
    const last = robust.lastIndexOf("}");
    if (first !== -1 && last !== -1) {
       return JSON.parse(robust.slice(first, last + 1));
    }
  } catch (e) {
    // still failing
  }

  // 3. Third attempt: Specific Field Extraction (The "Regex Sweep")
  // This saves us when the model stutters (e.g. "key": "key": "value") or fails to close braces.
  const result: Record<string, any> = {};

  // Regex to capture "subconscious_thought": "VALUE"
  // Handles escaped quotes inside the value
  const thoughtMatch = robust.match(/"subconscious_thought"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (thoughtMatch) {
    // Unescape JSON string characters (e.g. \" becomes ")
    try {
        result.subconscious_thought = JSON.parse(`"${thoughtMatch[1]}"`);
    } catch {
        result.subconscious_thought = thoughtMatch[1];
    }
  }

  // Regex for curiosity_level (number)
  const curiosityMatch = robust.match(/"curiosity_level"\s*:\s*(\d+)/);
  if (curiosityMatch) {
    result.curiosity_level = parseInt(curiosityMatch[1], 10);
  }

  // Regex for reason_for_quitting
  const reasonMatch = robust.match(/"reason_for_quitting"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (reasonMatch) {
    try {
        result.reason_for_quitting = JSON.parse(`"${reasonMatch[1]}"`);
    } catch {
        result.reason_for_quitting = reasonMatch[1];
    }
  }

  return result;
}

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
    decision_reason?: string | null;
    subconscious_thought?: string | null;
    curiosity_level?: number | null;
    raw_assistant_text?: string | null;
    raw_function_args?: string | null;
    model_used?: string | null;
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
  
  // 1. INITIALIZE MEMORY
  // We store the agent's subconscious thoughts here to provide context for the next frame.
  const shortTermMemory: string[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    const imageUrl = await readJpegDataUrl(segment.framePath);
    
    // Increase tokens to allow for the "thought" argument generation
    const maxOutputTokens = 1024; 

    // 2. CONSTRUCT CONTEXT STRING
    // We map the memory to include timestamps so the agent sees the full narrative history.
    const memoryContext = shortTermMemory.length > 0 
      ? `FULL VIDEO HISTORY (Context):\n${shortTermMemory
          .map((thought, index) => `- Second ${index + 1}: ${thought}`)
          .join("\n")}`
      : "PREVIOUS THOUGHTS: None (Start of video)";

    const logModelOutput = deps.logModelOutput ?? false;
    
    const input: ChatMessage[] = [
      {
        role: "system" as const,
        // 3. INJECT THE DOPAMINE LADDER PROMPT
        content: `${persona.systemPrompt}\n\n${VIRAL_ANALYSIS_PROMPT}`
      },
      {
        role: "user" as const,
        content: [
          // 4. INJECT THE MEMORY CONTEXT
          { 
             type: "text" as const, 
             text: `CURRENT CONTEXT:\n${memoryContext}\n\nAnalyze this frame (Second ${i + 1}):` 
          },
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
    // We need to capture arguments now
    let accumulatedArgs = ""; 
    let assistantText = "";
    let finishReason: string | undefined;
    let sawToolCallDelta = false;
    let decisionReason: string | null = null;
    let subconsciousThought: string | null = null;
    let curiosityLevel: number | null = null;
    let modelUsed: string | null = null;

    try {
      await deps.client.streamToolCalls({
        messages: input,
        tools: deps.tools,
        toolChoice: "auto",
        maxOutputTokens,
        signal: controller.signal,
        callbacks: {
          onModelSelected: (model) => {
            modelUsed = model;
          },
          onFunctionCall: (call) => {
            if (call.name === "keep_playing" || call.name === "quit_video") {
              tool = call.name;
              // Note: We don't abort immediately if we want to capture arguments
              // But for the simulation speed, we might rely on the 'onEvent' or 'onFinish' 
              // depending on how your specific client streams arguments.
              // If your client streams args via onTextDelta or specialized callback, handle here.
              // If the client provided arguments on the function call, capture them for parsing.
              if (call.arguments) {
                accumulatedArgs += call.arguments;
                sawToolCallDelta = true;
              }
            }
          },
          onArgumentsDone: (args) => {
            if (args) {
              accumulatedArgs += args;
              sawToolCallDelta = true;
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
            // Standard parsing for debugging
            const parsed = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : undefined;
            const choices = parsed && Array.isArray(parsed.choices) ? parsed.choices : undefined;
            const delta = choices && choices[0]?.delta ? choices[0].delta : undefined;
            
            // Capture arguments from the raw stream if available
            if (delta && delta.tool_calls && delta.tool_calls[0]?.function?.arguments) {
                accumulatedArgs += delta.tool_calls[0].function.arguments;
                sawToolCallDelta = true;
            }
          },
        },
      });
      
    } catch (err) {
      if (!tool) throw err;
    }

    // Fallback logic for tool detection
    if (!tool) {
      const text = assistantText.trim();
      
      // 1. SMARTER REGEX: Look for keys specific to quitting
      const looksLikeQuit = 
          /"quit_video"\b/.test(text) || 
          /\bquit_video\b/.test(text) || 
          /reason_for_quitting/.test(text) || // <--- CATCHES THE FRAGMENT
          /_for_quitting/.test(text) ||       // <--- CATCHES THE LOG YOU SAW
          /quit\b/i.test(text);

      const looksLikeKeep = 
          /"keep_playing"\b/.test(text) || 
          /\bkeep_playing\b/.test(text) || 
          /subconscious_thought/.test(text) ||
          /curiosity_level/.test(text);

      if (looksLikeQuit) {
          tool = "quit_video";
      } else if (looksLikeKeep) {
          tool = "keep_playing";
      } else {
          // 2. SAFETY: If we are confused, don't just play. Check the text sentiment.
          // If the text is short and negative, default to quit.
          if (text.length > 0 && (text.includes("boring") || text.includes("low stimulation"))) {
              tool = "quit_video";
          } else {
              tool = "keep_playing";
          }
      }
    }

    // 5. PARSE ARGUMENTS AND UPDATE MEMORY
    let argsObj: any = {};

    // Strategy: 
    // 1. Try to parse the official tool arguments first.
    // 2. If that fails or is empty, try to parse the raw assistant text.
    // 3. Merge them (preferring tool args).

    const argsFromTool = extractFunctionArguments(accumulatedArgs);
    const argsFromText = extractFunctionArguments(assistantText);

    // Merge: Text extraction fills in gaps if tool extraction failed
    argsObj = { ...argsFromText, ...argsFromTool };

    // --- LOGIC TO MAP EXTRACTED ARGS TO STATE ---

    if (tool === "keep_playing") {
      // 1. Handle Subconscious Thought
      if (argsObj.subconscious_thought) {
        subconsciousThought = String(argsObj.subconscious_thought);
        
        // Clean up common "stuttering" artifacts seen in logs
        // e.g. "subconscious_thought": "I see..." becomes "I see..."
        if (subconsciousThought.startsWith('"subconscious_thought":')) {
           subconsciousThought = subconsciousThought.replace('"subconscious_thought":', '').trim();
           // Remove leading quotes if they were double-captured
           if (subconsciousThought.startsWith('"')) subconsciousThought = subconsciousThought.slice(1);
           if (subconsciousThought.endsWith('"')) subconsciousThought = subconsciousThought.slice(0, -1);
        }

        shortTermMemory.push(subconsciousThought);
        if (logModelOutput) {
          logger.info(`[${persona.id}] THOUGHT: ${subconsciousThought}`);
        }
        decisionReason = subconsciousThought;
      }

      // 2. Handle Curiosity Level
      if (typeof argsObj.curiosity_level !== "undefined") {
        const num = Number(argsObj.curiosity_level);
        if (!Number.isNaN(num)) {
            curiosityLevel = num;
        }
      }
      
      // Fallback: If we have a thought but no level, default to 5 so we don't break UI
      if (subconsciousThought && curiosityLevel === null) {
          curiosityLevel = 5; 
      }
    }

    if (tool === "quit_video") {
      if (argsObj.reason_for_quitting) {
        decisionReason = String(argsObj.reason_for_quitting);
      } else if (assistantText.length > 10) {
        // Fallback: If no structured reason found, use the raw text as the reason
        // (often models output the reason as plain text when quitting)
        decisionReason = assistantText.replace(/<.*?>/g, "").trim(); 
      } else {
        decisionReason = "Boredom (No specific reason provided)";
      }
    }

    if (logModelOutput) {
      logger.info(
        `[${persona.id}] segment=${segment.index} finish=${finishReason ?? "(unknown)"} ` +
          `tool=${tool ?? "(none)"} assistant_text=${JSON.stringify(assistantText.trim())}`,
      );
    }

    if (!tool) {
        // ... Error handling same as before ... 
         throw new Error(`Model did not call a tool for segment ${segment.index}`);
    }

    const result = applyDoubleQuitRule(state, tool, segment.index);
    state = result.state;

    deps.events?.emit("decision", {
      agentId: persona.id,
      segment,
      tool,
      decision: result.decision,
      state,
      decision_reason: decisionReason,
      subconscious_thought: subconsciousThought,
      curiosity_level: curiosityLevel,
      raw_assistant_text: assistantText.trim() || null,
      raw_function_args: accumulatedArgs || null,
      model_used: modelUsed ?? null,
    });

    // ... Recording logic same as before ... 
    // (You can add argsObj to the recorder if you update the recorder type definition)

    deps.reporter?.onSegment?.({
      agentId: persona.id,
      segment,
      tool,
      decision: result.decision,
      state,
      decision_reason: decisionReason,
      subconscious_thought: subconsciousThought,
      curiosity_level: curiosityLevel,
      raw_assistant_text: assistantText.trim() || null,
      raw_function_args: accumulatedArgs || null,
      model_used: modelUsed ?? null,
    });

    // Log the agent's returned values for debugging
    logger.info(
      `[${persona.id}] segment=${segment.index} tool=${tool} decision=${result.decision} ` +
        `decision_reason=${JSON.stringify(decisionReason)} subconscious_thought=${JSON.stringify(subconsciousThought)} curiosity_level=${String(
          curiosityLevel,
        )} raw_assistant_text=${JSON.stringify(assistantText.trim())} raw_function_args=${JSON.stringify(accumulatedArgs)}`,
    );

    // Persist segment output if recorder provided
    try {
      await deps.outputRecorder?.record({
        type: "segment",
        ts: new Date().toISOString(),
        runId: deps.runId ?? "",
        agentId: persona.id,
        segmentIndex: segment.index,
        framePath: segment.framePath,
        subtitle: segment.subtitle ?? "",
        modelTool: tool ?? "",
        coercedTool: result.coercedTool,
        model_used: modelUsed ?? null,
        decision: result.decision === "stop" ? "stop" : "continue",
        finishReason: finishReason ?? null,
        assistantText: assistantText.trim(),
        sawToolCallDelta,
        decision_reason: decisionReason ?? null,
        subconscious_thought: subconsciousThought ?? null,
        curiosity_level: curiosityLevel ?? null,
        raw_assistant_text: assistantText.trim() || null,
        raw_function_args: accumulatedArgs || null,
      });
    } catch (err) {
      logger.warn(`[${persona.id}] failed to record segment: ${String(err)}`);
    }

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