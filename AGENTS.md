# Repository Guidelines

## Project Structure & Module Organization

- `src/` – TypeScript source (CLI entry: `src/cli.ts`; library entry: `src/index.ts`).
- `tests/` – Bun tests (`*.test.ts`).
- `data/` – runtime outputs (e.g., `data/frames/`, `data/audio/`); treat as generated artifacts.
- Root files: `package.json`, `tsconfig.json`, `env.example`.

## Setup, Build, and Development Commands

- `bun install` – install dependencies (Bun `>= 1.1.3`).
- `cp env.example .env` – create local env config; set `OPENROUTER_API_KEY`.
- `bun start /path/to/video.mp4` – run the CLI (Bun auto-loads `.env`).
- `bun test` – run the test suite.
- `bun run test` – uses the repo’s test script which deletes `tests/._*.ts` (helps on macOS/external drives).
- `bun run lint` – runs `bun test --filter never` (used as a fast compile/sanity check).

Notes: `ffmpeg`/`ffprobe` are required for segmentation; `WHISPER_BIN` enables optional subtitle extraction.

## Coding Style & Naming Conventions

- TypeScript, ESM (`"type": "module"`).
- Formatting conventions in this repo: 2-space indent, double quotes, semicolons.
- Filenames: `camelCase.ts`; tests: `*.test.ts` in `tests/`.
- Prefer small, typed helpers (see `src/config.ts` using `zod` for env validation).

## Testing Guidelines

- Framework: `bun:test`.
- Keep tests deterministic and free of network calls; prefer unit tests around pure logic.
- When adding new behavior, add/extend a focused `*.test.ts` alongside related modules.

## Commit & Pull Request Guidelines

- Commit messages: imperative, sentence case (example from history: “Initialize … scaffold”).
- PRs should include: what changed, how to run it (`bun start …`), and any new/changed env vars.
- If behavior changes CLI output, include a short before/after snippet in the PR description.

## Security & Configuration Tips

- Never commit `.env` or API keys. Use `env.example` for documented defaults/shape.
- Avoid committing generated media (`data/**`) or large sample videos (e.g., local `*.mp4`).
