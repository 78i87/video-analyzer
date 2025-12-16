
type Decision = "CONTINUE" | "QUIT1" | "QUIT2";

type Props = {
  open: boolean;
  agentIndex: number;
  segments: Decision[];
  blockReasons?: (string | null)[];
  blockDetails?: { decision_reason?: string | null; subconscious_thought?: string | null; curiosity_level?: number | null; raw_assistant_text?: string | null; raw_function_args?: string | null; model_used?: string | null }[];
  onClose?: () => void;
};

export default function AgentDetailsPane({ open, agentIndex, segments, blockDetails = [], onClose }: Props) {
  return (
    <div className={`agent-details-pane ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="agent-details-header">
        <h3>Agent {agentIndex + 1}</h3>
        <button className="close-btn" onClick={onClose} aria-label="Close details">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div className="agent-details-body">
        {segments.length === 0 ? (
          <div className="no-segments">No segments yet</div>
        ) : (
          <ol className="segment-list">
            {segments.map((s, i) => {
              const det = blockDetails?.[i] ?? {};
              const isContinue = s === 'CONTINUE';
              return (
                <li key={i} className="segment-item">
                  <details open={i === segments.length - 1}>
                    <summary>
                      <span className={`seg-icon ${isContinue ? 'seg-continue' : 'seg-quit'}`}>
                        {isContinue ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" fill="var(--status-continue)" />
                            <path d="M7 13l2.5 2.5L17 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                            <circle cx="12" cy="12" r="10" fill="var(--status-quit2)" />
                            <path d="M15 9l-6 6M9 9l6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className="segment-summary-text">
                        Segment {i + 1} — {isContinue ? 'continue' : 'quit'}
                      </span>
                      {det.model_used && (
                        <span className="segment-model">{det.model_used}</span>
                      )}
                    </summary>
                    <div className="segment-details">
                      {isContinue ? (
                        <>
                          <div><strong>Thought:</strong> {det.subconscious_thought ?? det.raw_function_args ?? det.raw_assistant_text ?? "—"}</div>
                          <div><strong>Curiosity:</strong> {typeof det.curiosity_level === 'number' ? det.curiosity_level : "—"}</div>
                        </>
                      ) : (
                        <div><strong>Reason:</strong> {det.decision_reason ?? det.raw_function_args ?? det.raw_assistant_text ?? "—"}</div>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
