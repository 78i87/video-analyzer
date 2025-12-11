# Video Virality Simulator (Bun + TypeScript)

Segments a video, streams segments to 5 OpenRouter LLM agents with tool-calling, enforces a double-quit rule, and prints a terminal retention summary.

## Setup

```bash
bun install
cp env.example .env    # fill in OPENROUTER_API_KEY
```

## Running

```bash
bun start /path/to/video.mp4
```

Bun automatically loads `.env`. The CLI currently wires config, stubs segmentation, and agent scaffolding; the heavy lifting will be filled in next.

## Tests

```bash
bun test
```

## Key files

- `src/config.ts` – type-safe env loader with defaults and dir creation.
- `src/videoSegmenter.ts` – ffmpeg/whisper dependency checks and segment scaffolding.
- `src/openrouterClient.ts` – streaming OpenRouter client with SSE tool-call parsing.
- `src/agentRunner.ts` – double-quit logic and agent placeholders.
- `tests/logic.test.ts` – double-quit unit coverage.
