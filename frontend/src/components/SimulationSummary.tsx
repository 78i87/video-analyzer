
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
      <h2>Results</h2>
      <div className="summary-stats">
        <div>
          <strong>Agents</strong>
          <span className="value">{summary.count}</span>
        </div>
        <div>
          <strong>Avg Watch</strong>
          <span className="value">{formatSeconds(summary.avg)} <small>({pct.toFixed(1)}%)</small></span>
        </div>
        <div>
          <strong>Min Watch</strong>
          <span className="value">{formatSeconds(summary.min)}</span>
        </div>
        <div>
          <strong>Max Watch</strong>
          <span className="value">{formatSeconds(summary.max)}</span>
        </div>
        <div>
          <strong>Total Watched</strong>
          <span className="value">{formatSeconds(summary.total)}</span>
        </div>
        <div>
          <strong>Video Duration</strong>
          <span className="value">{formatSeconds(summary.videoDurationSeconds)}</span>
        </div>
      </div>
    </div>
  );
}
