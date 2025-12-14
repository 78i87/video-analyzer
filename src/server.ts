import { Elysia } from "elysia";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";

import { loadConfig } from "./config";
import { segmentVideo } from "./videoSegmenter";
import { OpenRouterClient } from "./openrouterClient";
import { runAgent, viewerTools, type AgentPersona } from "./agentRunner";
import { logger } from "./logger";

const UPLOADS_DIR = resolve("./uploads");
const UPLOAD_PATH = resolve(UPLOADS_DIR, "temp.mp4");

mkdirSync(UPLOADS_DIR, { recursive: true });

const app = new Elysia();

// POST /api/upload: accepts multipart/form-data with field `file`
app.post("/api/upload", async ({ request, set }) => {
  try {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) return { ok: false, error: "missing file field" };

    const buffer = await file.arrayBuffer();
    await Bun.write(UPLOAD_PATH, new Uint8Array(buffer));
    return { ok: true, path: UPLOAD_PATH };
  } catch (err) {
    logger.warn(`Upload failed: ${String(err)}`);
    set.status = 500;
    return { ok: false, error: String(err) };
  }
});

// WS /ws: control / events channel
app.ws("/ws", {
  open: (ws) => {
    logger.info("WebSocket connection opened");
  },
  message: async (ws, message) => {
    try {
      let text = "";
      if (typeof message === "string") {
        text = message;
      } else if (message instanceof ArrayBuffer) {
        text = new TextDecoder().decode(new Uint8Array(message));
      } else if (ArrayBuffer.isView(message)) {
        text = new TextDecoder().decode(message as Uint8Array);
      } else if (message && typeof (message as any).data === "string") {
        text = (message as any).data;
      } else if (message && (message as any).data instanceof ArrayBuffer) {
        text = new TextDecoder().decode(new Uint8Array((message as any).data));
      } else if (message !== undefined && message !== null) {
        try {
          text = String(message);
        } catch (_err) {
          text = "";
        }
      }

      let msg: any = undefined;
      if (text) {
        const t = text.trim();
        const first = t[0];
        // ignore common '[object Object]' string produced by naive string coercion
        if (/^\[object\s+/.test(t)) {
          msg = undefined;
        } else if (first === "{" || first === "[") {
          try {
            msg = JSON.parse(t);
          } catch (parseErr) {
            try { ws.send(JSON.stringify({ event: "error", payload: `WS JSON parse error: ${String(parseErr)} -- ${t.slice(0,200)}` })); } catch (_) {}
            msg = undefined;
          }
        } else {
          // text isn't JSON; leave msg undefined and attempt to use original object below
          msg = undefined;
        }
      }

      // If the incoming `message` was already an object, prefer that over text parsing
      if (!msg && message && typeof message === "object") {
        if ((message as any).type) {
          msg = message as any;
        } else if ((message as any).data && typeof (message as any).data === "object") {
          msg = (message as any).data;
        } else {
          // fallback: use the whole object
          msg = message as any;
        }
      }
      if (msg?.type === "START_SIMULATION") {
        let config;
        try {
          config = loadConfig();
        } catch (err) {
          try { ws.send(JSON.stringify({ event: "error", payload: `loadConfig error: ${String(err)}` })); } catch (_) {}
          return;
        }

        // allow client to override agent count or other knobs
        const agentCount = typeof msg.agentCount === "number" ? msg.agentCount : config.agentCount;

        // prepare segments from the uploaded file
        const segments = await segmentVideo(UPLOAD_PATH, {
          ffmpegBin: config.ffmpegBin,
          ffprobeBin: config.ffprobeBin,
          whisperBin: config.whisperBin,
          frameDir: config.frameDir,
          audioDir: config.audioDir,
          segmentIntervalSeconds: config.segmentIntervalSeconds,
        });

        const client = new OpenRouterClient(config.openrouterApiKey, config.openrouterModel);

        const personas: AgentPersona[] = Array.from({ length: agentCount }).map((_, idx) => ({
          id: `agent-${idx + 1}`,
          systemPrompt: `You are retention reviewer #${idx + 1}. Decide if the viewer keeps watching or quits after each clip.`,
        }));

        const emitter = new EventEmitter();

        // Forward events to the websocket
        emitter.on("decision", (payload) => {
          try { ws.send(JSON.stringify({ event: "decision", payload })); } catch (_) {}
        });
        emitter.on("stop", (payload) => {
          try { ws.send(JSON.stringify({ event: "stop", payload })); } catch (_) {}
        });

        // notify client how many segments were prepared and total duration
        const videoDurationSeconds = segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
        try { ws.send(JSON.stringify({ event: "segmentsPrepared", payload: { count: segments.length, videoDurationSeconds } })); } catch (_) {}

        // run agents in parallel
        const runs = personas.map((persona) =>
          runAgent(persona, segments, {
            client,
            tools: viewerTools,
            runId: new Date().toISOString(),
            events: emitter,
          }),
        );

        Promise.all(runs)
          .then((results) => {
            try { ws.send(JSON.stringify({ event: "done", payload: results })); } catch (_) {}
            ws.close();
          })
          .catch((err) => {
            try { ws.send(JSON.stringify({ event: "error", payload: String(err) })); } catch (_) {}
            ws.close();
          });
      }
    } catch (err) {
      try { ws.send(JSON.stringify({ event: "error", payload: String(err) })); } catch (_) {}
    }
  },
  close: (ws) => {
    logger.info("WebSocket closed");
  },
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port });
logger.info(`Server listening on http://localhost:${port}`);

export default app;
