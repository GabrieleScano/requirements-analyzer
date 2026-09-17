#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeStory } from './analyzer.js';
import { loadEnv } from './load-env.js';
import { parseStory, StoryValidationError } from './core/parse-story.js';
import { SEVERITIES, type AnalysisReport, type Severity } from './core/types.js';

// Load an optional ANTHROPIC_API_KEY from a local .env file to enable the AI layer.
loadEnv();

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'HIGH  ',
  medium: 'MEDIUM',
  low: 'LOW   ',
};

/** Higher rank means more serious; `none` disables the gate entirely. */
const SEVERITY_RANK: Record<Severity | 'none', number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

type FailOn = Severity | 'none';

interface Options {
  readonly paths: readonly string[];
  readonly json: boolean;
  readonly failOn: FailOn;
}

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_FINDINGS = 2;

function version(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf-8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const USAGE = `Usage: reqcheck [options] <story.json> [...more.json]

Analyzes user stories and acceptance criteria for ambiguities, missing edge
cases and testability problems.

Options:
  --json               Emit machine-readable JSON instead of formatted text.
  --fail-on <level>    Exit with code 2 when a finding of this severity or
                       worse is present: high (default), medium, low, none.
  -h, --help           Show this help.
  -V, --version        Show the version.

Exit codes:
  0  no finding at or above the --fail-on threshold
  1  usage error, unreadable file, or invalid story
  2  findings at or above the threshold (use as a CI gate)`;

class UsageError extends Error {}

function parseArgs(argv: readonly string[]): Options | 'help' | 'version' {
  const paths: string[] = [];
  let json = false;
  let failOn: FailOn = 'high';
  let optionsEnded = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;

    if (optionsEnded || !arg.startsWith('-') || arg === '-') {
      paths.push(arg);
      continue;
    }

    switch (arg) {
      case '--':
        optionsEnded = true;
        break;
      case '-h':
      case '--help':
        return 'help';
      case '-V':
      case '--version':
        return 'version';
      case '--json':
        json = true;
        break;
      case '--fail-on': {
        const value = argv[i + 1];
        if (value === undefined) throw new UsageError('--fail-on requires a level.');
        if (!(value in SEVERITY_RANK)) {
          throw new UsageError(
            `Unknown --fail-on level "${value}" (expected: ${[...SEVERITIES, 'none'].join(', ')}).`,
          );
        }
        failOn = value as FailOn;
        i++;
        break;
      }
      default:
        throw new UsageError(`Unknown option "${arg}".`);
    }
  }

  if (paths.length === 0) throw new UsageError('No story file given.');
  return { paths, json, failOn };
}

function printReport(report: AnalysisReport, showHeader: boolean): void {
  if (showHeader) console.log();
  console.log(`\nRequirements analysis — story ${report.storyId}`);
  console.log('='.repeat(48));
  console.log(`Clarity score: ${report.clarityScore}/100\n`);

  if (report.findings.length === 0) {
    console.log('No issues detected. Criteria look clear and testable.');
    return;
  }

  console.log(`${report.findings.length} finding(s):\n`);
  for (const f of report.findings) {
    console.log(`[${SEVERITY_LABEL[f.severity]}] (${f.category}) ${f.message}`);
    if (f.criterion) {
      console.log(`           ↳ "${f.criterion}"`);
    }
  }
}

/** Read and analyze one story file; validation problems surface as errors. */
async function analyzePath(path: string): Promise<AnalysisReport> {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') throw new Error(`File not found: ${path}`);
    if (code === 'EISDIR') throw new Error(`Not a file: ${path}`);
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${path}: ${detail}`);
  }

  try {
    return await analyzeStory(parseStory(raw));
  } catch (error) {
    if (error instanceof StoryValidationError) {
      throw new Error(`${path}: ${error.message}`);
    }
    throw error;
  }
}

async function main(): Promise<void> {
  let options: Options;
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed === 'help') {
      console.log(USAGE);
      return;
    }
    if (parsed === 'version') {
      console.log(version());
      return;
    }
    options = parsed;
  } catch (error) {
    console.error(error instanceof UsageError ? `Error: ${error.message}\n` : error);
    console.error(USAGE);
    process.exitCode = EXIT_ERROR;
    return;
  }

  const reports: AnalysisReport[] = [];
  let failed = false;

  for (const path of options.paths) {
    try {
      reports.push(await analyzePath(path));
    } catch (error) {
      failed = true;
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ reports }, null, 2));
  } else {
    reports.forEach((report, index) => printReport(report, index > 0));
  }

  if (failed) {
    process.exitCode = EXIT_ERROR;
    return;
  }

  // Non-zero exit when findings reach the threshold: usable as a CI gate.
  const threshold = SEVERITY_RANK[options.failOn];
  const breached =
    threshold > 0 &&
    reports.some((r) => r.findings.some((f) => SEVERITY_RANK[f.severity] >= threshold));

  process.exitCode = breached ? EXIT_FINDINGS : EXIT_OK;
}

main().catch((error: unknown) => {
  console.error('Analysis failed:', error instanceof Error ? error.message : error);
  process.exitCode = EXIT_ERROR;
});
