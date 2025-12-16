# Video Virality Simulator (Bun + TypeScript)

Segments a video, streams segments to OpenRouter LLM agents with tool-calling, enforces a double-quit rule, and displays retention metrics via a web interface.

## Setup

```bash
bun install
cd frontend && bun install
cd ..
cp env.example .env    # fill in OPENROUTER_API_KEY
```

## Running

Start both backend and frontend with a single command:

```bash
bun run dev
```

This starts:
- Backend (Elysia) on `http://localhost:3000`
- Frontend (Vite) on `http://localhost:5173`

Open `http://localhost:5173` in your browser.

### Running Individually

- **Backend only:** `bun run server`
- **Frontend only:** `cd frontend && bun run dev`

Note: Start the backend first if running individually, as the frontend proxies `/api/*` and `/ws` to port 3000.

### Troubleshooting

If you see an error like `Cannot find module @rollup/rollup-darwin-arm64`, reinstall frontend deps:

```bash
cd frontend
rm -rf node_modules bun.lockb
bun install
```

## Production Build

```bash
bun run build
```

This builds the frontend to `frontend/dist`. For production deployment, run `bun run server` and serve `frontend/dist` via nginx/CDN.

## Tests

```bash
bun test
# If you see failures loading "tests/._*.ts" on macOS/external drives:
bun run test
```

## Key files

- `src/config.ts` - type-safe env loader with defaults and dir creation.
- `src/server.ts` - Elysia HTTP/WebSocket server.
- `src/videoSegmenter.ts` - ffmpeg/whisper dependency checks and segment scaffolding.
- `src/openrouterClient.ts` - streaming OpenRouter client with SSE tool-call parsing.
- `src/agentRunner.ts` - double-quit logic and agent placeholders.
- `tests/logic.test.ts` - double-quit unit coverage.
