import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStory } from '../src/analyzer.js';
import type { UserStory } from '../src/core/types.js';

const story: UserStory = {
  id: 'AN-1',
  title: 'Story',
  story: 'As a user, I want to log in so that I can access my account.',
  acceptanceCriteria: ['Given valid credentials, when I submit, then an error is never shown.'],
};

const originalFetch = globalThis.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

function stubAi(payload: unknown): void {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] }),
  })) as unknown as typeof fetch;
}

test('a malformed AI response does not break the analysis', async () => {
  stubAi({ result: 'ok' });
  const report = await analyzeStory(story);
  assert.equal(report.storyId, 'AN-1');
  assert.ok(Number.isFinite(report.clarityScore));
});

test('an off-schema severity never produces a NaN clarity score', async () => {
  stubAi({ findings: [{ category: 'perf', severity: 'critical', message: 'boom' }] });
  const report = await analyzeStory(story);
  assert.ok(Number.isInteger(report.clarityScore), `got ${report.clarityScore}`);
  assert.ok(report.clarityScore >= 0 && report.clarityScore <= 100);
});

test('a failing AI layer still reports the deterministic findings', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;

  const report = await analyzeStory({ ...story, acceptanceCriteria: [] });
  assert.ok(report.findings.some((f) => f.severity === 'high'));
});

test('valid AI findings are merged with the rule findings', async () => {
  stubAi({ findings: [{ category: 'testability', severity: 'medium', message: 'from ai' }] });
  const report = await analyzeStory(story);
  assert.ok(report.findings.some((f) => f.message === 'from ai'));
});
