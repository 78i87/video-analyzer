import { describe, expect, it } from "bun:test";
import { summarizeSimulation } from "../src/simulationSummary";
import type { Segment } from "../src/videoSegmenter";

describe("summarizeSimulation", () => {
  it("computes per-agent watch time and average", () => {
    const segments: Segment[] = [
      { index: 0, start: 0, end: 1, framePath: "/tmp/a.jpg", subtitle: "" },
      { index: 1, start: 1, end: 2, framePath: "/tmp/b.jpg", subtitle: "" },
      { index: 2, start: 2, end: 3.25, framePath: "/tmp/c.jpg", subtitle: "" },
    ];

    const summary = summarizeSimulation(segments, [
      { agentId: "agent-1", stopSegmentIndex: 0 }, // quits after first window
      { agentId: "agent-2", stopSegmentIndex: 2 }, // quits at end
      { agentId: "agent-3", stopSegmentIndex: undefined }, // watches full video
    ]);

    expect(summary.videoDurationSeconds).toBeCloseTo(3.25, 6);
    expect(summary.perAgent.map((r) => r.watchSeconds)).toEqual([1, 3.25, 3.25]);
    expect(summary.averageWatchSeconds).toBeCloseTo((1 + 3.25 + 3.25) / 3, 6);
  });

  it("returns zeros when there are no segments or agents", () => {
    const summary = summarizeSimulation([], []);
    expect(summary.videoDurationSeconds).toBe(0);
    expect(summary.averageWatchSeconds).toBe(0);
    expect(summary.perAgent).toEqual([]);
  });
});

