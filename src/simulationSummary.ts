import type { Segment } from "./videoSegmenter";
import type { AgentRunResult } from "./agentRunner";

export type AgentWatchSummary = {
  agentId: string;
  stopSegmentIndex?: number;
  watchSeconds: number;
};

export type SimulationSummary = {
  videoDurationSeconds: number;
  averageWatchSeconds: number;
  perAgent: AgentWatchSummary[];
};

export function getVideoDurationSecondsFromSegments(segments: Segment[]): number {
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1]!;
  return last.end;
}

export function getWatchSecondsForStopIndex(
  segments: Segment[],
  stopSegmentIndex: number | undefined,
): number {
  if (segments.length === 0) return 0;

  if (stopSegmentIndex === undefined) {
    return getVideoDurationSecondsFromSegments(segments);
  }

  const clamped = Math.max(0, Math.min(stopSegmentIndex, segments.length - 1));
  return segments[clamped]!.end;
}

export function summarizeSimulation(
  segments: Segment[],
  results: AgentRunResult[],
): SimulationSummary {
  const perAgent = results.map((r) => ({
    agentId: r.agentId,
    stopSegmentIndex: r.stopSegmentIndex,
    watchSeconds: getWatchSecondsForStopIndex(segments, r.stopSegmentIndex),
  }));

  const totalWatchSeconds = perAgent.reduce((sum, row) => sum + row.watchSeconds, 0);
  const averageWatchSeconds = perAgent.length === 0 ? 0 : totalWatchSeconds / perAgent.length;

  return {
    videoDurationSeconds: getVideoDurationSecondsFromSegments(segments),
    averageWatchSeconds,
    perAgent,
  };
}

