import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRuleChecks, scoreClarity } from '../src/core/rules.js';
import type { UserStory } from '../src/core/types.js';

const flawedStory: UserStory = {
  id: 'T-1',
  title: 'Flawed',
  story: 'As a user I want search so that I find things.',
  acceptanceCriteria: ['The search should be fast and return good results.'],
};

const cleanStory: UserStory = {
  id: 'T-2',
  title: 'Clean',
  story: 'As a user, I want to reset my password so that I can regain access.',
  acceptanceCriteria: [
    'Given a valid email, when I request a reset, then a link is sent within 1 minute.',
    'Given an invalid email, when I request a reset, then an error is shown.',
  ],
};

test('flags ambiguous terms', () => {
  const findings = runRuleChecks(flawedStory);
  assert.ok(findings.some((f) => f.category === 'ambiguity'));
});

test('flags missing negative path', () => {
  const findings = runRuleChecks(flawedStory);
  assert.ok(findings.some((f) => f.category === 'missing-edge-case'));
});

test('clean story scores higher than flawed story', () => {
  const flawedScore = scoreClarity(runRuleChecks(flawedStory));
  const cleanScore = scoreClarity(runRuleChecks(cleanStory));
  assert.ok(cleanScore > flawedScore);
});

test('empty criteria produce a high-severity finding', () => {
  const findings = runRuleChecks({ ...cleanStory, acceptanceCriteria: [] });
  assert.ok(findings.some((f) => f.severity === 'high'));
});
