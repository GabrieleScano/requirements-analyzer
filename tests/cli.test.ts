import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
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
