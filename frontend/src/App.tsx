import React, { useState, useEffect } from "react";
import "./App.css";
import ControlPanel from "./components/ControlPanel";
import AgentLane from "./components/AgentLane";
import LiveLog from "./components/LiveLog";
import SimulationSummary from "./components/SimulationSummary";
import AgentDetailsPane from "./components/AgentDetailsPane";

type Decision = "CONTINUE" | "QUIT1" | "QUIT2";

export default function App() {
  const [agentCount, setAgentCount] = useState<number>(5);
  const [agents, setAgents] = useState<Decision[][]>([]);
  const [dead, setDead] = useState<boolean[]>([]);
  type BlockDetail = { decision_reason?: string | null; subconscious_thought?: string | null; curiosity_level?: number | null; raw_assistant_text?: string | null; raw_function_args?: string | null; model_used?: string | null };
  const [blockDetails, setBlockDetails] = useState<BlockDetail[][]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);

  // total segments and video duration sent from server
  const [totalSegments, setTotalSegments] = useState<number>(0);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number>(0);

  // current per-agent watch seconds (updated on each decision)
  const [watchSeconds, setWatchSeconds] = useState<number[]>([]);
  // final per-agent watch seconds when simulation finishes / agent stops
  const [finalWatchSeconds, setFinalWatchSeconds] = useState<(number | undefined)[]>([]);

  useEffect(() => {
    setAgents(Array.from({ length: agentCount }, () => []));
    setDead(Array.from({ length: agentCount }, () => false));
    setWatchSeconds(Array.from({ length: agentCount }, () => 0));
    setFinalWatchSeconds(Array.from({ length: agentCount }, () => undefined));
    setBlockDetails(Array.from({ length: agentCount }, () => []));
  }, [agentCount]);

  function appendLog(line: string) {
    setLogs((s) => [...s, line]);
  }

  async function onStart({ agentCount: a, file }: { agentCount: number; file?: File | null }) {
    setAgentCount(a);
    setRunning(true);
    setAgents(Array.from({ length: a }, () => []));
    setDead(Array.from({ length: a }, () => false));
    setLogs([]);
    setTotalSegments(0);
    setVideoDurationSeconds(0);
    setWatchSeconds(Array.from({ length: a }, () => 0));
    setFinalWatchSeconds(Array.from({ length: a }, () => undefined));
    setBlockDetails(Array.from({ length: a }, () => []));

      // upload file if provided
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        try {
          const res = await fetch("/api/upload", { method: "POST", body: fd });
          const text = await res.text();
          let json: any;
          try {
            json = text ? JSON.parse(text) : null;
          } catch (err) {
            appendLog(`Upload response not JSON: ${text.slice(0, 200)}`);
            setRunning(false);
            return;
          }

          if (!json || !json.ok) {
            appendLog(`Upload failed: ${json?.error ?? "unknown"}`);
            setRunning(false);
            return;
          }
        } catch (err) {
          appendLog(`Upload error: ${String(err)}`);
          setRunning(false);
          return;
        }
      }

    // open websocket to server
      const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${wsProto}//${location.host}/ws`;
      const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      appendLog("WS connected — starting simulation");
      ws.send(JSON.stringify({ type: "START_SIMULATION", agentCount: a }));
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        const { event, payload } = msg as { event: string; payload: any };
        if (event === "segmentsPrepared") {
          setTotalSegments(payload.count ?? 0);
          setVideoDurationSeconds(payload.videoDurationSeconds ?? 0);
          appendLog(`Segments prepared: ${payload.count}`);
        } else if (event === "decision") {
          const { agentId, segment, tool, decision, decision_reason } = payload;
          // debug: log decision payload fields used for tooltips
          // includes optional fields that may be present on payload
          console.debug("WS decision payload:", {
            agentId,
            segment,
            tool,
            decision,
            decision_reason,
            subconscious_thought: payload?.subconscious_thought,
            curiosity_level: payload?.curiosity_level,
          });
          let subconscious: string | null = payload?.subconscious_thought ?? null;
          let curiosity: number | null = typeof payload?.curiosity_level === "number" ? payload.curiosity_level : null;
          const rawArgs: string | null = payload?.raw_function_args ?? null;
          const rawText: string | null = payload?.raw_assistant_text ?? null;
          const modelUsed: string | null = payload?.model_used ?? payload?.modelUsed ?? null;

          // Try to parse structured fields from raw function args if primary fields are missing
          if ((!subconscious || subconscious === "") && rawArgs) {
            try {
              const parsed = JSON.parse(rawArgs);
              if (parsed && typeof parsed === "object") {
                if (!subconscious && parsed.subconscious_thought) subconscious = String(parsed.subconscious_thought);
                if (curiosity === null && typeof parsed.curiosity_level === "number") curiosity = parsed.curiosity_level;
              }
            } catch (_e) {
              // ignore parse errors
            }
          }

          // As a last resort try to extract JSON from assistant text
          if ((!subconscious || subconscious === "") && rawText) {
            const jsonMatch = rawText.match(/\{.*\}/s);
            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                if (parsed && typeof parsed === "object") {
                  if (!subconscious && parsed.subconscious_thought) subconscious = String(parsed.subconscious_thought);
                  if (curiosity === null && typeof parsed.curiosity_level === "number") curiosity = parsed.curiosity_level;
                }
              } catch (_e) {
                // ignore
              }
            }
          }
          const idx = Number(agentId.split("-")[1]) - 1;
          if (idx >= 0 && idx < a) {
            setAgents((prev) => {
              const next = prev.map((r) => [...r]);
              const block: Decision =
                tool === "keep_playing" ? "CONTINUE"
                : tool === "quit_video" && decision === "continue" ? "QUIT1"
                : "QUIT2";
              next[idx] = [...next[idx], block];
              return next;
            });

            setBlockDetails((prev) => {
              const next = prev.map((r) => [...r]);
              next[idx] = [...(next[idx] ?? []), { decision_reason: decision_reason ?? null, subconscious_thought: subconscious ?? null, curiosity_level: curiosity, raw_assistant_text: rawText ?? null, raw_function_args: rawArgs ?? null, model_used: modelUsed }];
              return next;
            });

            appendLog(`${agentId}: ${tool} -> ${decision} (segment=${segment?.index})`);
          }
        } else if (event === "stop") {
          const { agentId, stopSegmentIndex, stopSeconds } = payload;
          const idx = Number(agentId.split("-")[1]) - 1;
          if (idx >= 0 && idx < a) {
            setDead((prev) => {
              const copy = [...prev];
              copy[idx] = true;
              return copy;
            });

            // set final watch seconds to last seen watchSeconds for that agent
            setFinalWatchSeconds((prev) => {
              const copy = [...prev];
              copy[idx] = typeof stopSeconds === "number" ? stopSeconds : (copy[idx] ?? 0);
              return copy;
            });

            appendLog(`${agentId} stopped at segment ${stopSegmentIndex}`);
          }
        } else if (event === "error") {
          appendLog(`Server error: ${String(payload)}`);
        } else if (event === "done") {
          // server sends enriched results with `stopSeconds` for each agent
          const results: { agentId: string; stopSegmentIndex?: number; stopSeconds?: number }[] = payload;
          setFinalWatchSeconds((prev) => {
            const copy = [...prev];
            for (let i = 0; i < a; i++) {
              const res = results[i];
              if (res && typeof res.stopSeconds === "number") copy[i] = res.stopSeconds;
              else if (copy[i] === undefined) copy[i] = videoDurationSeconds;
            }
            return copy;
          });
          setRunning(false);
          appendLog("Simulation finished (done)");
          try { ws.close(); } catch (_) {}
        }
      } catch (err) {
        appendLog(`WS message parse error: ${String(err)}`);
      }
    };

    ws.onclose = () => {
      appendLog("WS closed");
    };
  }

  const segmentCount = totalSegments || agents.reduce((m, row) => Math.max(m, row.length), 0);

  const summary = React.useMemo(() => {
    if (running) return null; // only show summary when simulation finished
    const vals = finalWatchSeconds.filter((v): v is number => typeof v === "number");
    if (!vals || vals.length === 0) return null;
    const count = vals.length;
    const total = vals.reduce((s, v) => s + v, 0);
    const avg = total / count;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { avg, min, max, count, total, videoDurationSeconds };
  }, [finalWatchSeconds, videoDurationSeconds, running]);

  return (
    <div className="app">
      {/* Backdrop for details pane */}
      <div
        className={`details-backdrop ${selectedAgent !== null ? 'visible' : ''}`}
        onClick={() => setSelectedAgent(null)}
      />

      {/* Agent Details Pane */}
      <AgentDetailsPane
        open={selectedAgent !== null}
        agentIndex={selectedAgent ?? 0}
        segments={selectedAgent !== null ? agents[selectedAgent] ?? [] : []}
        blockDetails={selectedAgent !== null ? blockDetails[selectedAgent] ?? [] : []}
        onClose={() => setSelectedAgent(null)}
      />

      {/* Header */}
      <header className="app-header">
        <div className="app-title">
          <div className="app-title-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </div>
          <h1>Video Virality Simulator</h1>
        </div>
        {segmentCount > 0 && (
          <div className="segment-badge">
            Segments: <span>{segmentCount}</span>
          </div>
        )}
      </header>

      {/* Control Panel */}
      <ControlPanel defaultAgents={5} onStart={onStart} />

      {/* Agent Visualizer */}
      <section className="visualizer-section">
        <h2 className="section-header">Agent Activity</h2>
        <div className="visualizer">
          {agents.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 6v6l4 2"/>
                </svg>
              </div>
              <p>Upload a video and start the simulation</p>
            </div>
          ) : (
            agents.map((blocks, i) => (
              <AgentLane
                key={i}
                agentName={`Agent ${i + 1}`}
                blocks={blocks}
                blockDetails={blockDetails[i]}
                isDead={dead[i]}
                segmentCount={segmentCount}
                watchSeconds={finalWatchSeconds[i] ?? watchSeconds[i]}
                videoDurationSeconds={videoDurationSeconds}
                onSelect={() => setSelectedAgent((prev) => (prev === i ? null : i))}
              />
            ))
          )}
        </div>
      </section>

      {/* Live Log */}
      <section className="log-section">
        <h2 className="section-header">Activity Log</h2>
        <LiveLog lines={logs} />
      </section>

      {/* Summary */}
      <SimulationSummary summary={summary} />
    </div>
  );
}
