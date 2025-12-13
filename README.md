# Video Virality Simulator (Bun + TypeScript)

Segments a video, streams segments to 5 OpenRouter LLM agents with tool-calling, enforces a double-quit rule, and prints a terminal retention summary.

## Setup

```bash
bun install
cp env.example .env    # fill in OPENROUTER_API_KEY
```

## Running

```bash
bun start "/path/to/video.mp4"
```

Bun automatically loads `.env`.
Segmentation extracts a single JPEG frame every `SEGMENT_INTERVAL_SECONDS` (default: 1). No audio is extracted; if `WHISPER_BIN` is set, the segment `subtitle` field is populated via Whisper JSON output.
This project sends frames to OpenRouter as `image_url` content parts, so `OPENROUTER_MODEL` must be a vision-capable model.

To record each agent's raw model output per segment to a file, set `AGENT_OUTPUT_LOG=1` (logs are written as JSONL under `AGENT_OUTPUT_LOG_DIR`, default `data/agent-logs`).

## Tests

```bash
bun test
# If you see failures loading "tests/._*.ts" on macOS/external drives:
bun run test
```

## Key files

- `src/config.ts` – type-safe env loader with defaults and dir creation.
- `src/videoSegmenter.ts` – ffmpeg/whisper dependency checks and segment scaffolding.
- `src/openrouterClient.ts` – streaming OpenRouter client with SSE tool-call parsing.
- `src/agentRunner.ts` – double-quit logic and agent placeholders.
- `tests/logic.test.ts` – double-quit unit coverage.
