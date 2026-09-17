import { readFileSync } from 'node:fs';

/**
 * Minimal, dependency-free `.env` loader.
 *
 * Reads KEY=VALUE pairs from a `.env` file (if present) and sets any that
 * are not already defined in `process.env`. A missing file is a no-op, so
 * the tool keeps running fully offline — the AI layer simply stays disabled.
 * Kept dependency-free on purpose: the rule engine has no runtime deps and
 * loading a single optional key shouldn't add one.
 *
 * The default path is resolved against the current working directory, not
 * the install location: running the published `reqcheck` binary from an
 * unrelated directory will not pick up this repository's `.env`. Export
 * `ANTHROPIC_API_KEY` in the environment for that case — an already-defined
 * variable always wins over the file.
 */
export function loadEnv(path = '.env'): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return; // no .env file — nothing to load
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    // Strip optional surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
