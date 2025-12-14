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

// basic health endpoint to help the frontend dev proxy and debugging
app.get("/health", () => ({ ok: true }));

// global error handlers so startup crashes are printed clearly
process.on("uncaughtException", (err) => {
  logger.error(`Uncaught exception: ${String(err)}\n${err && (err as Error).stack ? (err as Error).stack : "(no stack)"}`);
  // allow process to exit with non-zero code so external wrappers see failure
  process.exitCode = 1;
});

process.on("unhandledRejection", (reason) => {
  logger.error(`Unhandled rejection: ${String(reason)}`);
  process.exitCode = 1;
});

// POST /api/upload: accepts multipart/form-data with field `file`
app.post("/api/upload", async ({ request, set }) => {
  try {
    logger.info("/api/upload: incoming upload request");
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) {
      logger.warn("/api/upload: missing 'file' field in form data");
      set.status = 400;
      return { ok: false, error: "missing file field" };
    }

    // log file metadata when available
    try {
      const name = (file as any).name ?? "(unknown)";
      const size = typeof (file as any).size === "number" ? (file as any).size : undefined;
      logger.info(`/api/upload: receiving file name=${name} size=${size ?? "unknown"}`);
    } catch (_) {}

    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (err) {
      logger.error(`/api/upload: failed to read uploaded file: ${String(err)}`);
      set.status = 400;
      return { ok: false, error: `failed to read uploaded file: ${String(err)}` };
    }

    try {
      await Bun.write(UPLOAD_PATH, new Uint8Array(buffer));
      logger.info(`/api/upload: wrote upload to ${UPLOAD_PATH}`);
      return { ok: true, path: UPLOAD_PATH };
    } catch (err) {
      logger.error(`/api/upload: failed to write upload: ${String(err)}`);
      set.status = 500;
      return { ok: false, error: `failed to write upload: ${String(err)}` };
    }
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

        logger.info(
          `OpenRouter config: model=${config.openrouterModel} fallback=[${config.openrouterModelFallback.join(",")}] maxAttempts=${config.openrouterModelMaxAttempts}`,
        );

        const client = new OpenRouterClient(config.openrouterApiKey, config.openrouterModel, {
          fallbackModels: config.openrouterModelFallback,
          maxAttempts: config.openrouterModelMaxAttempts,
        });

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
          try {
            // augment stop payload with stopSeconds computed from segments
            const stopIndex = (payload && typeof payload.stopSegmentIndex === "number") ? payload.stopSegmentIndex : undefined;
            const stopSeconds = stopIndex === undefined ? (segments.length === 0 ? 0 : segments[segments.length - 1]!.end) :
              Math.max(0, Math.min(stopIndex, segments.length - 1)) >= 0 ? segments[Math.max(0, Math.min(stopIndex, segments.length - 1))]!.end : 0;
            const out = { ...(payload ?? {}), stopSeconds };
            ws.send(JSON.stringify({ event: "stop", payload: out }));
          } catch (_) {}
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
            logModelOutput: true,
          }),
        );

        Promise.all(runs)
          .then((results) => {
            try {
              // augment final results with stopSeconds for frontend convenience
              const enriched = results.map((r) => {
                const stopIndex = typeof r.stopSegmentIndex === "number" ? r.stopSegmentIndex : undefined;
                const stopSeconds = stopIndex === undefined ? (segments.length === 0 ? 0 : segments[segments.length - 1]!.end) :
                  Math.max(0, Math.min(stopIndex, segments.length - 1)) >= 0 ? segments[Math.max(0, Math.min(stopIndex, segments.length - 1))]!.end : 0;
                return { ...r, stopSeconds };
              });
              ws.send(JSON.stringify({ event: "done", payload: enriched }));
            } catch (_) {}
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
try {
  app.listen({ port });
  logger.info(`Server listening on http://localhost:${port}`);
} catch (err) {
  logger.error(`Failed to start server: ${String(err)}`);
  // rethrow so the process exits with failure when run directly
  throw err;
}

export default app;
