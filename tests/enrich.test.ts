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

/** The request the stub last received, for asserting on what we send. */
let lastRequest: { url: string; init: RequestInit } | undefined;

/** Replace global fetch with a stub returning a canned response. */
function stubFetch(response: unknown, ok = true): void {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    lastRequest = { url, init };
    return { ok, status: ok ? 200 : 500, json: async () => response };
  }) as unknown as typeof fetch;
}

/** The JSON body of the last stubbed request. */
function lastBody(): Record<string, unknown> {
  assert.ok(lastRequest, 'no request was made');
  return JSON.parse(String(lastRequest.init.body)) as Record<string, unknown>;
}

/** Stub a response whose single text block is `text`. */
function stubText(text: string): void {
  stubFetch({ content: [{ type: 'text', text }] });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  lastRequest = undefined;
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

// --- the AI layer must never break the analysis ---

test('returns no findings when the response omits the findings key', async () => {
  // Valid JSON, wrong shape: this used to reach the analyzer as `undefined`
  // and crash the spread with "aiFindings is not iterable".
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubText(JSON.stringify({ result: 'ok' }));
  assert.deepEqual(await enrichWithAi(story), []);
});

test('returns no findings when findings is not an array', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubText(JSON.stringify({ findings: 'nope' }));
  assert.deepEqual(await enrichWithAi(story), []);
});

test('drops findings with a category or severity outside the schema', async () => {
  // An unknown severity used to make the clarity score NaN and print
  // "[undefined]" in the report.
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubText(
    JSON.stringify({
      findings: [
        { category: 'perf', severity: 'critical', message: 'boom' },
        { category: 'ambiguity', severity: 'blocker', message: 'boom' },
        { category: 'ambiguity', severity: 'high', message: 'kept' },
      ],
    }),
  );
  const findings = await enrichWithAi(story);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.message, 'kept');
});

test('drops findings with a missing or empty message', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubText(
    JSON.stringify({
      findings: [
        { category: 'ambiguity', severity: 'high' },
        { category: 'ambiguity', severity: 'high', message: '   ' },
        { category: 'ambiguity', severity: 'high', message: 'kept' },
      ],
    }),
  );
  assert.equal((await enrichWithAi(story)).length, 1);
});

test('tolerates a response with no content blocks', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubFetch({});
  assert.deepEqual(await enrichWithAi(story), []);
});

test('never returns a criterion field from the model', async () => {
  // Findings are matched to criteria by the rule engine only; an AI-supplied
  // criterion would be scored as criterion-level and skew the average.
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubText(
    JSON.stringify({
      findings: [{ category: 'ambiguity', severity: 'low', message: 'm', criterion: 'injected' }],
    }),
  );
  const findings = await enrichWithAi(story);
  assert.equal(findings[0]?.criterion, undefined);
});

// --- request shape ---

test('requests the current model with a JSON schema and a timeout', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  stubText(JSON.stringify({ findings: [] }));
  await enrichWithAi(story);

  const body = lastBody();
  assert.equal(body['model'], 'claude-opus-5');

  const outputConfig = body['output_config'] as { format?: { type?: string } };
  assert.equal(outputConfig?.format?.type, 'json_schema');

  assert.ok(lastRequest?.init.signal, 'expected an abort signal for the timeout');
});

test('gives up when the request times out', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  globalThis.fetch = (async () => {
    throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' });
  }) as unknown as typeof fetch;
  assert.deepEqual(await enrichWithAi(story), []);
});
