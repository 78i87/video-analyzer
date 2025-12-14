import React from "react";

type Decision = "CONTINUE" | "QUIT1" | "QUIT2";

type Props = {
  agentName: string;
  blocks: Decision[];
  isDead?: boolean;
  segmentCount?: number;
  watchSeconds?: number;
  videoDurationSeconds?: number;
};
export default function AgentLane({ agentName, blocks, isDead, segmentCount = 0, watchSeconds = 0, videoDurationSeconds = 0 }: Props) {

  function formatSeconds(s: number) {
    if (!Number.isFinite(s) || s <= 0) return "0.00s";
    return `${s.toFixed(2)}s`;
  }

  // Show a CLI-like final status when agent is stopped, otherwise show current watch time.
  const statusText = isDead
    ? `quit video at ${formatSeconds(watchSeconds)}`
    : `watched ${formatSeconds(watchSeconds || videoDurationSeconds || segmentCount)}`;

  // current segment index (1-based) and last block color
  const currentIndex = blocks.length; // 0..N
  const totalSegments = segmentCount || Math.max(0, blocks.length);
  const lastBlock = blocks.length ? blocks[blocks.length - 1].toLowerCase() : null;

  return (
    <div className="agent-lane">
      <div className="agent-name" style={{ color: '#ffffff', fontWeight: 500 }}>
        <span style={{ color: '#ffffff' }}>{agentName}</span> —
        <span className="agent-status" style={{ color: '#ffffffff', marginLeft: '6px' }}>
          {lastBlock ? <span className={`status-icon status-${lastBlock}`} aria-hidden="true" /> : <span className="status-icon" style={{ opacity: 0.2 }} />}
          <span className="agent-seg" style={{ color: '#ffffff', marginLeft: '6px' }}>{currentIndex}/{totalSegments}</span>
        </span>
        <span
          style={{
            marginLeft: '8px',
            color: '#ffffff',
            fontWeight: 600,
            backgroundColor: 'rgba(255,255,255,0.0)'
          }}
          className="agent-time"
        >
          {statusText}
        </span>
      </div>
      <div className="blocks">
        {blocks.map((b, i) => (
          <div
            key={i}
            className={`block block-${b.toLowerCase()}`}
            title={b}
          />
        ))}
        {isDead ? <div className="skull">☠️</div> : null}
      </div>
    </div>
  );
}
