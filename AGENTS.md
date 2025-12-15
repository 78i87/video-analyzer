# Repository Guidelines

## Project Structure & Module Organization

- `src/`: TypeScript source (ESM).
  - `src/cli.ts`: CLI entry (`bun start <videoPath>`).
  - `src/index.ts`: Orchestration (`buildSimulation`).
  - `src/videoSegmenter.ts`: Frame extraction (ffmpeg) + optional Whisper transcript mapping.
  - `src/openrouterClient.ts`: OpenRouter streaming + tool-call parsing.
  - `src/agentRunner.ts`: Agent loop + “double-quit” rule logic.
- `tests/`: `bun:test` unit tests (`*.test.ts`).
- `data/`: Generated artifacts (frames/audio); ignored by Git.

## Build, Test, and Development Commands

- `bun install`: Install dependencies (requires Bun `>=1.1.3`).
- `bun start "/path/to/video.mp4"`: Run the simulator locally.
- `bun test`: Run the full test suite (also deletes macOS `tests/._*.ts` artifacts).
- `bun run lint`: Fast sanity check (`bun test --filter never`) to catch type/runtime import errors without running tests.

## Coding Style & Naming Conventions

- TypeScript, ESM (`"type": "module"`); prefer `import type` for type-only imports.
- Match existing style: 2-space indentation, double quotes, semicolons, trailing commas where used.
- Filenames are `camelCase.ts`; exported types are `PascalCase`, functions are `camelCase`.

## Testing Guidelines

- Framework: `bun:test` with `describe/it/expect`.
- Place tests in `tests/` and name them `*.test.ts` (e.g., `tests/videoSegmenter.test.ts`).
- Keep tests deterministic; avoid hitting the network—stub `fetch` like `tests/openrouterClient.test.ts`.

## Configuration, Data, and External Dependencies

- Copy `env.example` to `.env` and set `OPENROUTER_API_KEY`. Key knobs: `OPENROUTER_MODEL`, `SEGMENT_INTERVAL_SECONDS`, `AGENT_COUNT`, `LOG_MODEL_OUTPUT`.
- Requires `ffmpeg` and `ffprobe` on `PATH` (override with `FFMPEG_BIN` / `FFMPEG_PROBE_BIN`). Optional: `WHISPER_BIN` + `WHISPER_ARGS`.
- Don’t commit large media (`*.mp4`) or generated output (`data/`); both are gitignored.

## Commit & Pull Request Guidelines

- Commit messages follow a short, imperative style (e.g., “Handle …”, “Implement …”).
- PRs should include: what/why, how to run (`bun test`, `bun start …`), and any CLI output changes (paste sample output or screenshots).

