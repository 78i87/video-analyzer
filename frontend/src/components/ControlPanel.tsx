import React, { useState, useCallback } from "react";

type Props = {
  defaultAgents?: number;
  onStart: (opts: { agentCount: number; file?: File | null }) => void;
};

export default function ControlPanel({ defaultAgents = 5, onStart }: Props) {
  const [agentCount, setAgentCount] = useState<number>(defaultAgents);
  const [file, setFile] = useState<File | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) setFile(f);
  }, []);

  return (
    <div className="control-panel">
      <label className="label-inline">
        Number of agents:
        <input
          type="number"
          min={1}
          value={agentCount}
          onChange={(e) => setAgentCount(Number(e.target.value))}
        />
      </label>

      <div
        className="file-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        role="button"
      >
        {file ? <div className="file-name">{file.name}</div> : <div>Drag & drop a file here, or click to choose</div>}
        <input
          type="file"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden-file-input"
        />
      </div>

      <button className="start-button" onClick={() => onStart({ agentCount, file })}>
        Start Simulation
      </button>
    </div>
  );
}
