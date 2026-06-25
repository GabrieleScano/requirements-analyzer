import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { enrichWithAi } from '../src/ai/enrich.js';
import type { UserStory } from '../src/core/types.js';

const story: UserStory = {
  id: 'AI-1',
  title: 'Story',
  story: 'As a user, I want to log in so that I can access my account.',
  acceptanceCriteria: ['Given valid credentials, when I submit, then I am logged in.'],
};

const originalFetch = globalThis.fetch;
const originalKey = process.env.ANTHROPIC_API_KEY;

/** Replace global fetch with a stub returning a canned response. */
function stubFetch(response: unknown, ok = true): void {
  globalThis.fetch = (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => response,
  })) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalKey;
});

test('returns no findings when the API key is absent (offline)', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const findings = await enrichWithAi(story);
  assert.deepEqual(findings, []);
});

test('parses findings from a well-formed AI response', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubFetch({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          findings: [
            { category: 'ambiguity', severity: 'high', message: 'Undefined term "account".' },
          ],
        }),
      },
    ],
  });
  const findings = await enrichWithAi(story);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.message, 'Undefined term "account".');
});

test('tolerates markdown-fenced JSON from the model', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubFetch({
    content: [
      {
        type: 'text',
        text: '```json\n{"findings":[{"category":"testability","severity":"low","message":"x"}]}\n```',
      },
    ],
  });
  const findings = await enrichWithAi(story);
  assert.equal(findings.length, 1);
});

test('returns no findings on a non-OK HTTP response', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubFetch({}, false);
  assert.deepEqual(await enrichWithAi(story), []);
});

test('never throws when the network fails', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as unknown as typeof fetch;
  assert.deepEqual(await enrichWithAi(story), []);
});

test('returns no findings when the model emits invalid JSON', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubFetch({ content: [{ type: 'text', text: 'not json at all' }] });
  assert.deepEqual(await enrichWithAi(story), []);
});
