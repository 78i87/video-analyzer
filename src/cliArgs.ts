import type { Stats } from "node:fs";

export type ResolveVideoPathResult =
  | { ok: true; videoPath: string }
  | { ok: false; message: string };

type ExistsSyncFn = (path: string) => boolean;

export function resolveVideoPathArg(
  argv: string[],
  existsSync: ExistsSyncFn,
): ResolveVideoPathResult {
  if (argv.length === 0) {
    return { ok: false, message: "Usage: bun start <path-to-video>" };
  }

  if (argv.length === 1) {
    return { ok: true, videoPath: argv[0]! };
  }

  const joined = argv.join(" ");
  if (existsSync(joined)) {
    return { ok: true, videoPath: joined };
  }

  return {
    ok: false,
    message:
      `Unexpected extra arguments: ${argv.slice(1).join(" ")}\n` +
      `If your path contains spaces, quote it:\n` +
      `  bun start "${joined}"`,
  };
}

