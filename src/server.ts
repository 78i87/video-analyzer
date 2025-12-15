import { Elysia } from "elysia";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { EventEmitter } from "node:events";

import { loadConfig } from "./config";
import { segmentVideo, type Segment } from "./videoSegmenter";
import { OpenRouterClient } from "./openrouterClient";
import { runAgent, viewerTools, type AgentPersona } from "./agentRunner";
import { logger } from "./logger";

// WebSocket message types
type WebSocketStartMessage = {
  type: "START_SIMULATION";
  agentCount?: number;
};

type WebSocketMessage = WebSocketStartMessage | { type: string };

// Raw WebSocket message wrapper (some clients send { data: ... })
type RawWebSocketMessage =
  | string
  | ArrayBuffer
  | Uint8Array
  | { data?: string | ArrayBuffer | object; type?: string }
  | { type: string };

// File upload type (Bun's File has these properties)
interface UploadedFile {
  name?: string;
  size?: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

// Helper to extract typed message from raw WebSocket data
function parseWebSocketMessage(message: unknown): WebSocketMessage | undefined {
  // Convert to text if needed
  let text = "";
  if (typeof message === "string") {
    text = message;
  } else if (message instanceof ArrayBuffer) {
    text = new TextDecoder().decode(new Uint8Array(message));
  } else if (ArrayBuffer.isView(message)) {
    text = new TextDecoder().decode(message as Uint8Array);
  } else if (message && typeof message === "object") {
    const obj = message as Record<string, unknown>;
    // Handle wrapped messages like { data: "..." } or { data: {...} }
    if (typeof obj.data === "string") {
      text = obj.data;
    } else if (obj.data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(new Uint8Array(obj.data));
    } else if (typeof obj.type === "string") {
      // Already a typed message object
      return message as WebSocketMessage;
    } else if (obj.data && typeof obj.data === "object" && typeof (obj.data as Record<string, unknown>).type === "string") {
      return obj.data as WebSocketMessage;
    }
  }

  // Try to parse JSON from text
  if (text) {
    const trimmed = text.trim();
    // Ignore '[object Object]' strings
    if (/^\[object\s+/.test(trimmed)) return undefined;
    if (trimmed[0] === "{" || trimmed[0] === "[") {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
          return parsed as WebSocketMessage;
        }
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

const UPLOADS_DIR = resolve("./uploads");
const UPLOAD_PATH = resolve(UPLOADS_DIR, "temp.mp4");

mkdirSync(UPLOADS_DIR, { recursive: true });

// Helper to send WebSocket messages with error logging instead of silent swallowing
function wsSend(ws: { send: (data: string) => void }, data: object): boolean {
  try {
    ws.send(JSON.stringify(data));
    return true;
  } catch (err) {
    logger.warn(`WebSocket send failed: ${String(err)}`);
    return false;
  }
}

function stopSecondsFor(segments: Segment[], stopSegmentIndex: number | undefined) {
  if (segments.length === 0) return 0;
  if (typeof stopSegmentIndex !== "number") return segments[segments.length - 1]!.end;
  const clampedIndex = Math.max(0, Math.min(stopSegmentIndex, segments.length - 1));
  return segments[clampedIndex]!.end;
}

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
    const uploadedFile = file as UploadedFile;
    const name = uploadedFile.name ?? "(unknown)";
    const size = uploadedFile.size;
    logger.info(`/api/upload: receiving file name=${name} size=${size ?? "unknown"}`);

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
      const msg = parseWebSocketMessage(message);
      if (!msg) return;

      if (msg.type === "START_SIMULATION") {
        const startMsg = msg as WebSocketStartMessage;
        let config;
        try {
          config = loadConfig();
        } catch (err) {
          wsSend(ws, { event: "error", payload: `loadConfig error: ${String(err)}` });
          return;
        }

        // allow client to override agent count or other knobs
        const agentCount = typeof startMsg.agentCount === "number" ? startMsg.agentCount : config.agentCount;

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
          wsSend(ws, { event: "decision", payload });
        });
        emitter.on("stop", (payload) => {
          // augment stop payload with stopSeconds computed from segments
          const stopIndex = (payload && typeof payload.stopSegmentIndex === "number") ? payload.stopSegmentIndex : undefined;
          const stopSeconds = stopSecondsFor(segments, stopIndex);
          const out = { ...(payload ?? {}), stopSeconds };
          wsSend(ws, { event: "stop", payload: out });
        });

        // notify client how many segments were prepared and total duration
        const videoDurationSeconds = segments.length === 0 ? 0 : segments[segments.length - 1]!.end;
        wsSend(ws, { event: "segmentsPrepared", payload: { count: segments.length, videoDurationSeconds } });

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
            // augment final results with stopSeconds for frontend convenience
            const enriched = results.map((r) => {
              const stopIndex = typeof r.stopSegmentIndex === "number" ? r.stopSegmentIndex : undefined;
              const stopSeconds = stopSecondsFor(segments, stopIndex);
              return { ...r, stopSeconds };
            });
            wsSend(ws, { event: "done", payload: enriched });
            ws.close();
          })
          .catch((err) => {
            wsSend(ws, { event: "error", payload: String(err) });
            ws.close();
          });
      }
    } catch (err) {
      wsSend(ws, { event: "error", payload: String(err) });
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

export { app };
