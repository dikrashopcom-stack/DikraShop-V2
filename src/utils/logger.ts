import { env } from "./env";

type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

interface LogContext { [key: string]: unknown; }

function fmt(level: LogLevel, message: string, context?: LogContext): string {
  const ts = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const ctx = context ? " " + JSON.stringify(context) : "";
  return `[${ts}] ${tag} ${message}${ctx}`;
}

export const logger = {
  debug(msg: string, ctx?: LogContext) { if (LEVELS[env.LOG_LEVEL] <= 0) console.debug(fmt("debug", msg, ctx)); },
  info(msg: string, ctx?: LogContext)  { if (LEVELS[env.LOG_LEVEL] <= 1) console.log(fmt("info", msg, ctx)); },
  warn(msg: string, ctx?: LogContext)  { if (LEVELS[env.LOG_LEVEL] <= 2) console.warn(fmt("warn", msg, ctx)); },
  error(msg: string, ctx?: LogContext & { err?: unknown }) {
    if (LEVELS[env.LOG_LEVEL] <= 3) {
      const { err, ...rest } = ctx ?? {};
      const errObj = err instanceof Error ? { message: err.message } : err;
      console.error(fmt("error", msg, { ...rest, ...(errObj ? { error: errObj } : {}) }));
    }
  },
};
