import React, { useState, useEffect } from "react";
import "./App.css";
import ControlPanel from "./components/ControlPanel";
import AgentLane from "./components/AgentLane";
import LiveLog from "./components/LiveLog";

type Decision = "CONTINUE" | "QUIT1" | "QUIT2";

export default function App() {
  const [agentCount, setAgentCount] = useState<number>(5);
  const [agents, setAgents] = useState<Decision[][]>([]);
  const [dead, setDead] = useState<boolean[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

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
          const { agentId, segment, tool, decision, state } = payload;
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

            // update watch seconds from segment end
            setWatchSeconds((prev) => {
              const copy = [...prev];
              copy[idx] = segment?.end ?? copy[idx];
              return copy;
            });

            appendLog(`${agentId}: ${tool} -> ${decision} (segment=${segment?.index})`);
          }
        } else if (event === "stop") {
          const { agentId, stopSegmentIndex, state } = payload;
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
              copy[idx] = watchSeconds[idx] ?? copy[idx] ?? 0;
              return copy;
            });

            appendLog(`${agentId} stopped at segment ${stopSegmentIndex}`);
          }
        } else if (event === "done") {
          const results: { agentId: string; stopSegmentIndex?: number }[] = payload;
          // mark any agents that didn't stop as having watched full duration
          setFinalWatchSeconds((prev) => {
            const copy = [...prev];
            for (let i = 0; i < a; i++) {
              if (copy[i] === undefined) copy[i] = videoDurationSeconds || watchSeconds[i] || 0;
            }
            return copy;
          });
          setRunning(false);
          appendLog("Simulation finished (done)");
          try { ws.close(); } catch (_) {}
        } else if (event === "error") {
          appendLog(`Server error: ${String(payload)}`);
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

  return (
    <div id="root">
      <h1>Simulation Visualizer</h1>
      <ControlPanel defaultAgents={5} onStart={onStart} />

      {/* show how many segments (time steps) have been processed */}
      <div className="segment-count">Segments: {segmentCount}</div>

      <div className="visualizer">
        {agents.map((blocks, i) => (
          <AgentLane
            key={i}
            agentName={`Agent ${i + 1}`}
            blocks={blocks}
            isDead={dead[i]}
            segmentCount={segmentCount}
            watchSeconds={finalWatchSeconds[i] ?? watchSeconds[i]}
            videoDurationSeconds={videoDurationSeconds}
          />
        ))}
      </div>

      <h2>Live Log</h2>
      <LiveLog lines={logs} />
    </div>
  );
}
