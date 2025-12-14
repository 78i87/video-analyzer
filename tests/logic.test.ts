import { describe, expect, it } from "bun:test";
import { applyDoubleQuitRule, initialAgentState } from "../src/agentRunner";

describe("applyDoubleQuitRule", () => {
  it("coerces the first quit into keep_playing", () => {
    const first = applyDoubleQuitRule(initialAgentState(), "quit_video", 0);
    expect(first.decision).toBe("continue");
    expect(first.coercedTool).toBe("keep_playing");
    expect(first.state.firstQuitSeen).toBe(true);
    expect(first.state.status).toBe("probation");
  });

  it("stops after the second quit", () => {
    const state = { ...initialAgentState(), firstQuitSeen: true };
    const second = applyDoubleQuitRule(state, "quit_video", 3);
    expect(second.decision).toBe("stop");
    expect(second.coercedTool).toBe("quit_video");
    expect(second.state.stopSegmentIndex).toBe(3);
    expect(second.state.stopped).toBe(true);
    expect(second.state.status).toBe("stopped");
  });

  it("keeps playing when instructed", () => {
    const state = initialAgentState();
    const next = applyDoubleQuitRule(state, "keep_playing", 1);
    expect(next.decision).toBe("continue");
    expect(next.coercedTool).toBe("keep_playing");
    expect(next.state.firstQuitSeen).toBe(false);
    expect(next.state.status).toBe("watching");
  });
});
