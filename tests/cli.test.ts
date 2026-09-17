import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the CLI exactly as a user / CI would, capturing exit code and output. */
function runCli(...args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', ...args],
      { cwd: repoRoot },
      (error, stdout, stderr) => {
        const code =
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

test('exits 2 (CI gate) when a story has high-severity findings', async () => {
  const { code, stdout } = await runCli('examples/search-story.json');
  assert.equal(code, 2);
  assert.match(stdout, /Clarity score:/);
  assert.match(stdout, /finding\(s\)/);
});

test('exits 0 for a clean story', async () => {
  const { code, stdout } = await runCli('examples/good-story.json');
  assert.equal(code, 0);
  assert.match(stdout, /No issues detected/);
});

test('exits non-zero with usage when no file is given', async () => {
  const { code, stderr } = await runCli();
  assert.notEqual(code, 0);
  assert.match(stderr, /Usage:/);
});

const fixtures = mkdtempSync(join(tmpdir(), 'reqcheck-'));
after(() => rmSync(fixtures, { recursive: true, force: true }));

/** Write a fixture file and return its path. */
function fixture(name: string, contents: string): string {
  const path = join(fixtures, name);
  writeFileSync(path, contents);
  return path;
}

// --- help and version ---

test('--help prints usage and exits 0', async () => {
  const { code, stdout } = await runCli('--help');
  assert.equal(code, 0);
  assert.match(stdout, /Usage: reqcheck/);
  assert.match(stdout, /--fail-on/);
});

test('--version prints the package version', async () => {
  const { code, stdout } = await runCli('--version');
  assert.equal(code, 0);
  assert.match(stdout.trim(), /^\d+\.\d+\.\d+$/);
});

// --- machine-readable output ---

test('--json emits a parseable report', async () => {
  const { code, stdout } = await runCli('--json', 'examples/search-story.json');
  assert.equal(code, 2);

  const parsed = JSON.parse(stdout) as {
    reports: Array<{ storyId: string; clarityScore: number; findings: unknown[] }>;
  };
  assert.equal(parsed.reports.length, 1);
  assert.equal(parsed.reports[0]?.storyId, 'SEARCH-7');
  assert.ok(Number.isInteger(parsed.reports[0]?.clarityScore));
  assert.ok((parsed.reports[0]?.findings.length ?? 0) > 0);
});

test('--json keeps one report per file', async () => {
  const { stdout } = await runCli(
    '--json',
    'examples/search-story.json',
    'examples/good-story.json',
  );
  const parsed = JSON.parse(stdout) as { reports: Array<{ storyId: string }> };
  assert.deepEqual(
    parsed.reports.map((r) => r.storyId),
    ['SEARCH-7', 'AUTH-12'],
  );
});

// --- multiple files ---

test('analyzes several files in one run', async () => {
  const { code, stdout } = await runCli('examples/good-story.json', 'examples/search-story.json');
  assert.equal(code, 2);
  assert.match(stdout, /AUTH-12/);
  assert.match(stdout, /SEARCH-7/);
});

// --- the failure threshold ---

test('--fail-on none never fails the run', async () => {
  const { code } = await runCli('--fail-on', 'none', 'examples/search-story.json');
  assert.equal(code, 0);
});

test('--fail-on medium fails on a story with only medium findings', async () => {
  const path = fixture(
    'medium.json',
    JSON.stringify({
      id: 'M-1',
      title: 'Medium only',
      story: 'As a user, I want x so that y.',
      acceptanceCriteria: ['Given a query, when I search, then an error is shown fast.'],
    }),
  );
  assert.equal((await runCli(path)).code, 0, 'default threshold (high) should pass');
  assert.equal((await runCli('--fail-on', 'medium', path)).code, 2);
});

test('rejects an unknown --fail-on level', async () => {
  const { code, stderr } = await runCli('--fail-on', 'critical', 'examples/good-story.json');
  assert.equal(code, 1);
  assert.match(stderr, /Unknown --fail-on level/);
});

// --- input errors are readable, not stack traces ---

test('reports a missing file without a stack trace', async () => {
  const { code, stderr } = await runCli('does-not-exist.json');
  assert.equal(code, 1);
  assert.match(stderr, /File not found: does-not-exist\.json/);
  assert.ok(!stderr.includes('at '), `stack trace leaked:\n${stderr}`);
});

test('reports malformed JSON without a stack trace', async () => {
  const { code, stderr } = await runCli(fixture('broken.json', '{ broken'));
  assert.equal(code, 1);
  assert.match(stderr, /not valid JSON/);
  assert.ok(!stderr.includes('TypeError'), `raw error leaked:\n${stderr}`);
});

test('lists every problem in an invalid story', async () => {
  const { code, stderr } = await runCli(fixture('empty-object.json', '{"foo":1}'));
  assert.equal(code, 1);
  for (const field of ['id', 'title', 'story', 'acceptanceCriteria']) {
    assert.match(stderr, new RegExp(`"${field}"`));
  }
  assert.ok(!stderr.includes('at '), `stack trace leaked:\n${stderr}`);
});

test('reports a wrongly typed acceptanceCriteria', async () => {
  const path = fixture(
    'bad-criteria.json',
    JSON.stringify({ id: 'a', title: 'b', story: 'c', acceptanceCriteria: 'not an array' }),
  );
  const { code, stderr } = await runCli(path);
  assert.equal(code, 1);
  assert.match(stderr, /must be an array of strings/);
});

test('one bad file fails the run even if another succeeds', async () => {
  const { code, stderr } = await runCli('examples/good-story.json', 'missing.json');
  assert.equal(code, 1);
  assert.match(stderr, /File not found/);
});

test('rejects an unknown option', async () => {
  const { code, stderr } = await runCli('--nope', 'examples/good-story.json');
  assert.equal(code, 1);
  assert.match(stderr, /Unknown option "--nope"/);
  assert.match(stderr, /Usage: reqcheck/);
});
