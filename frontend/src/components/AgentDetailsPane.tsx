import React from "react";

type Decision = "CONTINUE" | "QUIT1" | "QUIT2";

type Props = {
  open: boolean;
  agentIndex: number;
  segments: Decision[];
  blockReasons?: (string | null)[];
  blockDetails?: { decision_reason?: string | null; subconscious_thought?: string | null; curiosity_level?: number | null; raw_assistant_text?: string | null; raw_function_args?: string | null; model_used?: string | null }[];
  onClose?: () => void;
};

export default function AgentDetailsPane({ open, agentIndex, segments, blockReasons = [], blockDetails = [], onClose }: Props) {
  return (
    <div className={`agent-details-pane ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="agent-details-header">
        <button className="close-btn" onClick={onClose} aria-label="Close details">×</button>
        <h3>Agent {agentIndex + 1}</h3>
      </div>
      <div className="agent-details-body">
        {segments.length === 0 ? (
          <div className="no-segments">No segments yet</div>
        ) : (
          <ol className="segment-list">
            {segments.map((s, i) => {
              const det = blockDetails?.[i] ?? {};
              return (
              <li key={i} className="segment-item">
                <details open>
                  <summary>
                    {s === 'CONTINUE' ? (
                      <span className="seg-icon seg-continue" aria-hidden>
                        <svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                          <circle cx="12" cy="12" r="10" fill="#66bb6a" />
                          <path d="M7 13l2.5 2.5L17 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      </span>
                    ) : (
                      <span className="seg-icon seg-quit" aria-hidden>
                        <svg width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                          <circle cx="12" cy="12" r="10" fill="#ef5350" />
                          <path d="M15 9l-6 6M9 9l6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                        </svg>
                      </span>
                    )}
                    <span className="segment-summary-text">{`Segment ${i + 1} - [${s === 'CONTINUE' ? 'continue' : 'quit'}]`}</span>
                    {det.model_used ? (
                      <span className="segment-model">{` ${det.model_used}`}</span>
                    ) : null}
                  </summary>
                  <div className="segment-details">
                    {s === 'CONTINUE' ? (
                      <>
                        <div><strong>subconscious_thought:</strong> {det.subconscious_thought ?? det.raw_function_args ?? det.raw_assistant_text ?? "(none)"}</div>
                        <div><strong>curiosity_level:</strong> {typeof det.curiosity_level === 'number' ? det.curiosity_level : "(none)"}</div>
                      </>
                    ) : (
                      <>
                        <div><strong>reason_for_quitting:</strong> {det.decision_reason ?? det.raw_function_args ?? det.raw_assistant_text ?? "(none)"}</div>
                      </>
                    )}
                  </div>
                </details>
              </li>
            )})}
          </ol>
        )}
      </div>
    </div>
  );
}
