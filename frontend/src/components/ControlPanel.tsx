import React, { useState, useCallback, useRef } from "react";

type Props = {
  defaultAgents?: number;
  onStart: (opts: { agentCount: number; file?: File | null }) => void;
};

export default function ControlPanel({ defaultAgents = 5, onStart }: Props) {
  const [agentCount, setAgentCount] = useState<number>(defaultAgents);
  const [file, setFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files?.[0] ?? null;
    if (f) setFile(f);
  }, []);

  const triggerFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="control-panel">
      <label className="label-inline">
        Agents
        <input
          type="number"
          min={1}
          max={50}
          value={agentCount}
          onChange={(e) => setAgentCount(Number(e.target.value))}
        />
      </label>

      <div
        className={`file-drop ${isDragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={onDrop}
        onClick={triggerFileDialog}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            triggerFileDialog();
          }
        }}
        tabIndex={0}
        role="button"
      >
        {file ? (
          <span className="file-name">{file.name}</span>
        ) : (
          <span>Drop video file or click to browse</span>
        )}
        <input
          type="file"
          accept="video/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden-file-input"
          ref={fileInputRef}
        />
      </div>

      <button className="start-button" onClick={() => onStart({ agentCount, file })}>
        Start
      </button>
    </div>
  );
}
