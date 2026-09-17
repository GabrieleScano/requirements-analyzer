import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStory, StoryValidationError } from '../src/core/parse-story.js';

const valid = JSON.stringify({
  id: 'X-1',
  title: 'Title',
  story: 'As a user, I want x so that y.',
  acceptanceCriteria: ['Given a, when b, then c.'],
});

/** Collect the problems reported for an invalid payload. */
function problemsFor(raw: string): string[] {
  try {
    parseStory(raw);
  } catch (error) {
    assert.ok(error instanceof StoryValidationError);
    return [...error.problems];
  }
  assert.fail('expected parseStory to throw');
}

test('accepts a well-formed story', () => {
  const story = parseStory(valid);
  assert.equal(story.id, 'X-1');
  assert.deepEqual(story.acceptanceCriteria, ['Given a, when b, then c.']);
});

test('rejects malformed JSON with a readable message', () => {
  const problems = problemsFor('{ broken');
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /not valid JSON/);
});

test('rejects a JSON value that is not an object', () => {
  assert.match(problemsFor('[]').join(), /Expected a JSON object/);
  assert.match(problemsFor('"a string"').join(), /Expected a JSON object/);
  assert.match(problemsFor('null').join(), /Expected a JSON object/);
});

test('reports every missing field at once, not just the first', () => {
  const problems = problemsFor('{"foo":1}');
  assert.equal(problems.length, 4);
  for (const field of ['id', 'title', 'story', 'acceptanceCriteria']) {
    assert.ok(
      problems.some((p) => p.includes(`"${field}"`)),
      `expected a problem mentioning ${field}`,
    );
  }
});

test('rejects acceptanceCriteria that is not an array', () => {
  const raw = JSON.stringify({ id: 'a', title: 'b', story: 'c', acceptanceCriteria: 'nope' });
  assert.match(problemsFor(raw).join(), /must be an array of strings \(got a string\)/);
});

test('rejects non-string entries inside acceptanceCriteria', () => {
  const raw = JSON.stringify({ id: 'a', title: 'b', story: 'c', acceptanceCriteria: ['ok', 42] });
  assert.match(problemsFor(raw).join(), /acceptanceCriteria\[1\] must be a string/);
});

test('rejects blank required fields', () => {
  const raw = JSON.stringify({ id: '  ', title: 'b', story: 'c', acceptanceCriteria: [] });
  assert.match(problemsFor(raw).join(), /"id" must not be empty/);
});

test('accepts an empty acceptanceCriteria array (the rule engine flags it)', () => {
  const raw = JSON.stringify({ id: 'a', title: 'b', story: 'c', acceptanceCriteria: [] });
  assert.deepEqual(parseStory(raw).acceptanceCriteria, []);
});
