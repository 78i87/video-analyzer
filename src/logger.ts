export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

export type Logger = {
  level: LogLevel;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
};

const levelOrder: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

function normalizeLevel(value: string | undefined): LogLevel {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "info";
  if (normalized === "silent") return "silent";
  if (normalized === "error") return "error";
  if (normalized === "warn" || normalized === "warning") return "warn";
  if (normalized === "info") return "info";
  if (normalized === "debug") return "debug";
  return "info";
}

export function createLogger(level?: string): Logger {
  const resolved = normalizeLevel(level);

  function enabled(at: LogLevel) {
    return levelOrder[resolved] >= levelOrder[at] && resolved !== "silent";
  }

  return {
    level: resolved,
    error: (...args) => enabled("error") && console.error(...args),
    warn: (...args) => enabled("warn") && console.warn(...args),
    info: (...args) => enabled("info") && console.info(...args),
    debug: (...args) => enabled("debug") && console.debug(...args),
  };
}

export let logger = createLogger(process.env.LOG_LEVEL);

export function setLogLevel(level?: string) {
  logger = createLogger(level);
}
