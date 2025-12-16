# Repository Guidelines

## Project Structure & Module Organization

- `src/`: Bun + TypeScript backend (Elysia HTTP + WebSocket). Entry: `src/server.ts`.
- `frontend/`: React + Vite UI. Source in `frontend/src/`, build output in `frontend/dist/`.
- `tests/`: Bun test suite (`*.test.ts`) covering backend logic and helpers.
- `uploads/`: temporary uploaded video (`temp.mp4`) and related artifacts (do not commit).
- `data/`: local runtime data/outputs created during analysis (treat as disposable).
- `env.example`: copy to `.env` for local configuration.

## Build, Test, and Development Commands

- `bun install` and `cd frontend && bun install`: install backend and frontend deps.
- `cp env.example .env`: create local env file (set `OPENROUTER_API_KEY`).
- `bun run dev`: run backend (`http://localhost:3000`) and frontend (`http://localhost:5173`) together.
- `bun run server`: run backend only.
- `cd frontend && bun run dev`: run frontend only (expects backend on port 3000 for `/api/*` and `/ws` proxy).
- `bun run build`: build the frontend into `frontend/dist`.
- `cd frontend && bun run lint`: run ESLint on the UI.
- `bun test` (or `bun run test`): run tests; the script also removes macOS `tests/._*.ts` metadata files.

## Coding Style & Naming Conventions

- TypeScript, ESM (`"type": "module"`). Prefer named exports and small, focused modules.
- Follow existing formatting: 2-space indentation, double quotes, semicolons.
- Frontend linting uses ESLint (`frontend/eslint.config.js`); keep changes lint-clean.
- Test files: `tests/<feature>.test.ts`. Keep unit tests deterministic and fast.

## Testing Guidelines

- Framework: `bun:test` (`describe/it/expect`).
- Add/adjust tests when changing core logic (e.g., agent rules, segmenting, OpenRouter parsing).
- Run a targeted test: `bun test --filter <substring>`.

## Commit & Pull Request Guidelines

- Commits in history are short, imperative subjects (e.g., “Implement…”, “Update…”); occasional `docs:` prefix—use the same style.
- PRs: include a clear summary, how to test (`bun run dev`, `bun test`), and screenshots for UI changes (`frontend/`).

## Security & Configuration Tips

- Never commit `.env` or API keys. Required: `OPENROUTER_API_KEY`.
- External tools: `ffmpeg` is expected (`FFMPEG_BIN`); optional transcription via `WHISPER_BIN`/`WHISPER_ARGS`.
