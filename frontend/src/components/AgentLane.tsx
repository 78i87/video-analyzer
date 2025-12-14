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

  return (
    <div className="agent-lane">
      <div className="agent-name">{agentName} — <span className="agent-time">{statusText}</span></div>
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
