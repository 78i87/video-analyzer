import { describe, expect, it } from "bun:test";
import { MultiAgentProgressUi } from "../src/progressUi";

function makeTtyStream() {
  const stream = {
    isTTY: true,
    columns: 80,
    output: "",
    write(chunk: string) {
      stream.output += chunk;
      return true;
    },
  };

  return stream as unknown as NodeJS.WritableStream & { output: string };
}

describe("MultiAgentProgressUi terminal teardown", () => {
  it("restores alt screen + cursor on stop()", () => {
    const stream = makeTtyStream();
    const ui = new MultiAgentProgressUi({
      agents: ["agent-1"],
      segments: [{ index: 0, start: 0, end: 1, framePath: "x.jpg", subtitle: "" }],
      stream,
    });

    ui.start();
    ui.stop({ newline: true });

    expect(stream.output).toContain("\x1b[?1049h\x1b[?25l");
    expect(stream.output).toContain("\x1b[?25h\x1b[?1049l\n");

    const afterFirstStop = stream.output;
    ui.stop({ newline: true });
    expect(stream.output).toBe(afterFirstStop);
  });

  it("prints average watch time after finish()", () => {
    const stream = makeTtyStream();
    const ui = new MultiAgentProgressUi({
      agents: ["agent-1"],
      segments: [{ index: 0, start: 0, end: 1, framePath: "x.jpg", subtitle: "" }],
      stream,
    });

    ui.start();
    ui.finish({
      videoDurationSeconds: 10,
      averageWatchSeconds: 2.5,
      perAgent: [{ agentId: "agent-1", watchSeconds: 2.5 }],
    });

    expect(stream.output).toContain("\x1b[?25h\x1b[?1049l\n");
    expect(stream.output).toContain("Average watch time (1 agents): 2.50s / 10.00s\n");
  });
});
