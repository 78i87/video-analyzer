import Tooltip from "./Tooltip";

type Decision = "CONTINUE" | "QUIT1" | "QUIT2";

type Props = {
  agentName: string;
  blocks: Decision[];
  blockDetails?: { decision_reason?: string | null; subconscious_thought?: string | null; curiosity_level?: number | null }[];
  isDead?: boolean;
  segmentCount?: number;
  watchSeconds?: number;
  videoDurationSeconds?: number;
  onSelect?: () => void;
};

function formatSeconds(s: number) {
  if (!Number.isFinite(s) || s <= 0) return "0.00s";
  return `${s.toFixed(2)}s`;
}

export default function AgentLane({ agentName, blocks, blockDetails, isDead, segmentCount = 0, watchSeconds = 0, videoDurationSeconds = 0, onSelect }: Props) {
  const currentIndex = blocks.length;
  const totalSegments = segmentCount || Math.max(0, blocks.length);
  const lastBlock = blocks.length ? blocks[blocks.length - 1].toLowerCase() : null;

  const statusClass = lastBlock === "continue" ? "continue" : lastBlock === "quit1" ? "quit1" : lastBlock === "quit2" ? "quit2" : "idle";

  return (
    <div
      className="agent-lane"
      onClick={() => onSelect?.()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.();
        }
      }}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
    >
      <div className="agent-info">
        <span className={`agent-status-indicator ${statusClass}`} />
        <span className="agent-name">{agentName}</span>
        <span className="agent-meta">
          <span>{currentIndex}/{totalSegments}</span>
          <span className="divider">/</span>
          <span className="agent-time">{formatSeconds(watchSeconds || videoDurationSeconds || 0)}</span>
          {isDead && <span className="divider">/</span>}
          {isDead && <span>stopped</span>}
        </span>
      </div>

      <div className="blocks">
        {blocks.map((b, i) => {
          const det = blockDetails?.[i] ?? {};
          const reason = det.decision_reason ?? det.subconscious_thought ?? (typeof det.curiosity_level === 'number' ? `curiosity ${det.curiosity_level}` : null);
          return (
            <Tooltip key={i} content={reason}>
              <span
                className={`block block-${b.toLowerCase()}`}
                aria-label={reason ? `${b}: ${reason}` : b}
              />
            </Tooltip>
          );
        })}
        {isDead && <span className="skull">x</span>}
      </div>
    </div>
  );
}
