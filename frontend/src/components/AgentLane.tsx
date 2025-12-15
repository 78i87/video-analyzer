import React from "react";
import Tooltip from "./Tooltip";
import { formatSeconds } from "../utils/formatting";

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
export default function AgentLane({ agentName, blocks, blockDetails, isDead, segmentCount = 0, watchSeconds = 0, videoDurationSeconds = 0, onSelect }: Props) {

  // Show a CLI-like final status when agent is stopped, otherwise show current watch time.
  const statusText = isDead
    ? `quit video at ${formatSeconds(watchSeconds)}`
    : `watched ${formatSeconds(watchSeconds || videoDurationSeconds || segmentCount)}`;

  // current segment index (1-based) and last block color
  const currentIndex = blocks.length; // 0..N
  const totalSegments = segmentCount || Math.max(0, blocks.length);
  const lastBlock = blocks.length ? blocks[blocks.length - 1].toLowerCase() : null;

  return (
    <div
      className="agent-lane"
      onClick={() => onSelect?.()}
      onKeyDown={(e) => {
        if ((e as any).key === "Enter" || (e as any).key === " ") {
          (e as any).preventDefault();
          onSelect?.();
        }
      }}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      style={{ cursor: onSelect ? 'pointer' : undefined }}
    >
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
        {blocks.map((b, i) => {
          const det = blockDetails?.[i] ?? {};
          const reason = det.decision_reason ?? det.subconscious_thought ?? (typeof det.curiosity_level === 'number' ? `curiosity ${det.curiosity_level}` : null);
          const title = reason ? `${b}: ${reason}` : b;
          const aria = reason ? `${b}: ${reason}` : b;
          return (
            <Tooltip key={i} content={reason}>
              <span
                className={`block block-${b.toLowerCase()}`}
                aria-label={aria}
              />
            </Tooltip>
          );
        })}
        {isDead ? <div className="skull">☠️</div> : null}
      </div>
    </div>
  );
}
