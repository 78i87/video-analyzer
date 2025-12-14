import React from "react";

type Summary = {
  avg: number;
  min: number;
  max: number;
  count: number;
  total: number;
  videoDurationSeconds: number;
};

type Props = { summary: Summary | null };

function formatSeconds(s: number) {
  if (!Number.isFinite(s)) return "0.00s";
  return `${s.toFixed(2)}s`;
}

export default function SimulationSummary({ summary }: Props) {
  if (!summary) return null;

  const pct = summary.videoDurationSeconds > 0 ? (summary.avg / summary.videoDurationSeconds) * 100 : 0;

  return (
    <div className="simulation-summary">
      <h2>Simulation Summary</h2>
      <div className="summary-stats">
        <div><strong>Agents:</strong> {summary.count}</div>
        <div><strong>Average watch:</strong> {formatSeconds(summary.avg)} ({pct.toFixed(1)}%)</div>
        <div><strong>Min watch:</strong> {formatSeconds(summary.min)}</div>
        <div><strong>Max watch:</strong> {formatSeconds(summary.max)}</div>
        <div><strong>Total watched:</strong> {formatSeconds(summary.total)}</div>
        <div><strong>Video duration:</strong> {formatSeconds(summary.videoDurationSeconds)}</div>
      </div>
    </div>
  );
}
