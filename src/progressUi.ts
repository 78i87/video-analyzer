import * as readline from "node:readline";
import type { Segment } from "./videoSegmenter";
import type { AgentState, AgentToolName, DoubleQuitDecision } from "./agentRunner";
import type { SimulationSummary } from "./simulationSummary";

export type AgentSegmentUpdate = {
  agentId: string;
  segment: Segment;
  tool: AgentToolName;
  decision: DoubleQuitDecision["decision"];
  state: AgentState;
};

type AgentRowState = {
  lastSegmentIndex: number;
  lastSegmentEndSeconds: number;
  status: "watching" | "stopped" | "done";
  stopSegmentIndex?: number;
};

function formatSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0.00s";
  return `${seconds.toFixed(2)}s`;
}

function makeBar(progress: number, width = 22) {
  const clamped = Math.max(0, Math.min(1, progress));
  const filled = Math.round(clamped * width);
  const empty = Math.max(0, width - filled);
  return `${"#".repeat(filled)}${"-".repeat(empty)}`;
}

function getColumns(stream: NodeJS.WritableStream): number | undefined {
  const cols = (stream as unknown as { columns?: unknown }).columns;
  return typeof cols === "number" && Number.isFinite(cols) && cols > 0 ? cols : undefined;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export class MultiAgentProgressUi {
  private readonly stream: NodeJS.WritableStream;
  private readonly totalSegments: number;
  private readonly agents: string[];
  private readonly rows: Map<string, AgentRowState>;
  private renderedLines: number;
  private started: boolean;
  private scheduled: boolean;
  private latestSummary: SimulationSummary | undefined;
  private usingAltScreen: boolean;
  private wroteFinalSummary: boolean;

  constructor(options: { agents: string[]; segments: Segment[]; stream?: NodeJS.WritableStream }) {
    this.stream = options.stream ?? process.stderr;
    this.totalSegments = options.segments.length;
    this.agents = options.agents;
    this.rows = new Map(
      options.agents.map((id) => [
        id,
        {
          lastSegmentIndex: -1,
          lastSegmentEndSeconds: 0,
          status: "watching",
        },
      ]),
    );
    this.renderedLines = 0;
    this.started = false;
    this.scheduled = false;
    this.usingAltScreen = false;
    this.wroteFinalSummary = false;
  }

  isEnabled() {
    return Boolean((this.stream as { isTTY?: boolean }).isTTY);
  }

  start() {
    if (!this.isEnabled()) return;
    if (this.started) return;
    this.started = true;

    // Use terminal alternate screen to avoid scroll/push artifacts during redraw.
    this.usingAltScreen = true;
    this.stream.write("\x1b[?1049h\x1b[?25l"); // enter alt screen + hide cursor

    this.renderNow();
  }

  stop(options?: { newline?: boolean }) {
    if (!this.started) return;
    this.restoreTerminal({ newline: options?.newline });
  }

  onSegment(update: AgentSegmentUpdate) {
    const row = this.rows.get(update.agentId);
    if (!row) return;

    row.lastSegmentIndex = update.segment.index;
    row.lastSegmentEndSeconds = update.segment.end;
    if (update.state.stopped) {
      row.status = "stopped";
      row.stopSegmentIndex = update.state.stopSegmentIndex;
    }

    this.scheduleRender();
  }

  onDone(agentId: string, stopSegmentIndex: number | undefined) {
    const row = this.rows.get(agentId);
    if (!row) return;

    if (stopSegmentIndex !== undefined) {
      row.status = "stopped";
      row.stopSegmentIndex = stopSegmentIndex;
    } else {
      row.status = "done";
    }

    this.scheduleRender();
  }

  finish(summary: SimulationSummary) {
    if (!this.started) return;
    this.latestSummary = summary;
    this.renderNow();
    this.restoreTerminal({ newline: true });
    this.writeFinalSummary(summary);
  }

  private restoreTerminal(options?: { newline?: boolean }) {
    try {
      if (this.usingAltScreen) {
        this.stream.write("\x1b[?25h\x1b[?1049l"); // show cursor + exit alt screen
        this.usingAltScreen = false;
      } else {
        this.stream.write("\x1b[?25h"); // show cursor (best-effort)
      }

      if (options?.newline) this.stream.write("\n");
    } finally {
      this.started = false;
    }
  }

  private writeFinalSummary(summary: SimulationSummary) {
    if (this.wroteFinalSummary) return;
    this.wroteFinalSummary = true;

    const avgLine = this.getAverageLine(summary);
    this.stream.write(`${avgLine}\n`);
  }

  private getAverageLine(summary: SimulationSummary) {
    const agentCount = this.agents.length;
    const label = agentCount > 0 ? `Average watch time (${agentCount} agents)` : "Average watch time";
    return `${label}: ${formatSeconds(summary.averageWatchSeconds)} / ${formatSeconds(summary.videoDurationSeconds)}`;
  }

  private scheduleRender() {
    if (!this.started) return;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      this.renderNow();
    });
  }

  private renderNow() {
    if (!this.started) return;

    const lines: string[] = [];
    lines.push(`Agents (${this.agents.length})`);

    const columns = getColumns(this.stream);

    for (const agentId of this.agents) {
      const row = this.rows.get(agentId)!;
      const completed = Math.max(0, row.lastSegmentIndex + 1);
      const progress = this.totalSegments === 0 ? 0 : completed / this.totalSegments;

      const totalDigits = String(Math.max(0, this.totalSegments)).length || 1;
      const completedText = String(completed).padStart(totalDigits);
      const totalText = String(this.totalSegments).padStart(totalDigits);

      const idText = agentId.length >= 8 ? agentId.slice(0, 8) : agentId.padEnd(8);
      const prefix = `${idText} [`;
      const suffixBase = `] ${completedText}/${totalText} ${formatSeconds(row.lastSegmentEndSeconds)}`;
      const statusSuffix =
        row.status === "stopped" ? " quit"
        : row.status === "done" ? " full"
        : "";

      const defaultBarWidth = 22;
      const maxBarWidth = 30;
      const minBarWidth = 10;
      const barWidth =
        columns === undefined ?
          defaultBarWidth
        : clamp(columns - (prefix.length + suffixBase.length + statusSuffix.length + 1), minBarWidth, maxBarWidth);

      const bar = makeBar(progress, barWidth);

      // Build a line that won't wrap; wrapped lines are hard to clear reliably.
      const fullLine = `${prefix}${bar}${suffixBase}${statusSuffix}`;
      const safeLine =
        columns !== undefined && fullLine.length >= columns ? fullLine.slice(0, Math.max(0, columns - 1)) : fullLine;

      lines.push(safeLine);
    }

    if (this.latestSummary) {
      const columns = getColumns(this.stream);
      const avgLine = this.getAverageLine(this.latestSummary);
      lines.push(
        columns !== undefined && avgLine.length >= columns ? avgLine.slice(0, Math.max(0, columns - 1)) : avgLine,
      );
    }

    if (this.usingAltScreen) {
      // Always render from the top-left in alt-screen mode.
      readline.cursorTo(this.stream, 0, 0);
    } else {
      // We intentionally do not end the previous render on an extra trailing newline.
      // That means the cursor ends on the last UI line, so to return to the top we move up (renderedLines - 1).
      if (this.renderedLines > 1) readline.moveCursor(this.stream, 0, -(this.renderedLines - 1));
      readline.cursorTo(this.stream, 0);
    }

    // Clear everything below the UI block start. This makes redraw resilient to:
    // - prior wrapped lines
    // - terminal resize
    // - any cursor drift
    readline.clearScreenDown(this.stream);

    if (this.usingAltScreen) {
      // Render the entire frame in a single write to avoid partially-drawn intermediate states.
      // \x1b[H = cursor home, \x1b[J = clear screen from cursor down, \x1b[2K = clear current line.
      const frame =
        "\x1b[H\x1b[J" +
        lines
          .map((line) => `\x1b[2K${line}`)
          .join("\n");

      this.stream.write(frame);
    } else {
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx]!;
        readline.clearLine(this.stream, 0);
        this.stream.write(line);
        if (idx < lines.length - 1) this.stream.write("\n");
      }
    }

    this.renderedLines = lines.length;
  }
}
