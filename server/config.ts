// Server configuration from environment variables (summon design, "Server").
import { DEFAULT_GEMINI_MODEL, isValidModelId } from '../src/summon/gemini.js';

export interface ServerConfig {
  apiKey: string | null;
  model: string;
  dailyCap: number;
  perIpCap: number;
  allowedOrigins: readonly string[];
  port: number;
  /** Directory of the built app served on every non-/api path; `null` serves the API only. */
  staticDir: string | null;
}

export const DEFAULTS = {
  model: DEFAULT_GEMINI_MODEL,
  dailyCap: 100,
  perIpCap: 10,
  allowedOrigins: 'http://localhost:5173,http://localhost:5174',
  port: 8787,
  staticDir: 'dist',
} as const;

export type Env = Record<string, string | undefined>;

function nonNegativeInt(value: string | undefined, fallback: number, name: string, warn: (m: string) => void): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number(value.trim());
  if (Number.isInteger(n) && n >= 0) return n;
  warn(`${name} must be a non-negative integer; using ${fallback}`);
  return fallback;
}

/** Exact origins, trimmed, without a trailing slash. */
export function parseOrigins(value: string): string[] {
  return value
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(o => o !== '');
}

export function readConfig(env: Env, warn: (message: string) => void = () => {}): ServerConfig {
  const apiKey = env.GEMINI_API_KEY?.trim() || null;
  let model: string = env.GEMINI_MODEL?.trim() || DEFAULTS.model;
  if (!isValidModelId(model)) {
    warn(`GEMINI_MODEL is not a valid model id; using ${DEFAULTS.model}`);
    model = DEFAULTS.model;
  }
  let port = nonNegativeInt(env.PORT, DEFAULTS.port, 'PORT', warn);
  if (port < 1 || port > 65535) {
    warn(`PORT must be between 1 and 65535; using ${DEFAULTS.port}`);
    port = DEFAULTS.port;
  }
  return {
    apiKey,
    model,
    dailyCap: nonNegativeInt(env.DAILY_CAP, DEFAULTS.dailyCap, 'DAILY_CAP', warn),
    perIpCap: nonNegativeInt(env.PER_IP_CAP, DEFAULTS.perIpCap, 'PER_IP_CAP', warn),
    allowedOrigins: parseOrigins(env.ALLOWED_ORIGINS ?? DEFAULTS.allowedOrigins),
    port,
    // An explicitly empty STATIC_DIR turns the app off (API only); unset means dist/.
    staticDir: env.STATIC_DIR === undefined ? DEFAULTS.staticDir : env.STATIC_DIR.trim() || null,
  };
}
