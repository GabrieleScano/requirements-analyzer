import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRuleChecks, scoreClarity } from '../src/core/rules.js';
import type { Finding, UserStory } from '../src/core/types.js';

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

/** Build a single-criterion story to isolate one rule at a time. */
function storyWith(criterion: string): UserStory {
  return {
    id: 'T',
    title: 'Test',
    story: 'As a user, I want to do something so that I get value.',
    acceptanceCriteria: [criterion],
  };
}

function categories(findings: readonly Finding[]): string[] {
  return findings.map((f) => f.category);
}

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

test('a fully clean story produces no findings', () => {
  assert.equal(runRuleChecks(cleanStory).length, 0);
});

test('flags an unmeasured threshold term', () => {
  const findings = runRuleChecks(
    storyWith('Given a query, when I search, then a large result set loads.'),
  );
  assert.ok(findings.some((f) => f.category === 'measurability'));
});

test('flags a weak modal verb', () => {
  const findings = runRuleChecks(
    storyWith('Given a user, when they log in, then the dashboard might appear.'),
  );
  assert.ok(
    findings.some((f) => f.category === 'testability' && /weak modal/i.test(f.message)),
  );
});

test('does not flag "should" as a weak modal (avoids noise)', () => {
  const findings = runRuleChecks(
    storyWith('Given a user, when they log in, then they should reach the dashboard.'),
  );
  assert.ok(!findings.some((f) => /weak modal/i.test(f.message)));
});

test('flags a criterion that is not in Given/When/Then form', () => {
  const findings = runRuleChecks(storyWith('The dashboard loads after login.'));
  assert.ok(
    findings.some((f) => f.category === 'structure' && /Given\/When\/Then/i.test(f.message)),
  );
});

test('matches ambiguous terms on word boundaries only', () => {
  // "somewhere" must not trigger the "some" rule.
  const findings = runRuleChecks(
    storyWith('Given input, when I submit, then the file is stored somewhere safe.'),
  );
  assert.ok(!findings.some((f) => f.category === 'ambiguity'));
});

test('flags a story missing the "so that" benefit', () => {
  const story: UserStory = {
    id: 'T',
    title: 'No benefit',
    story: 'As a user, I want to export my data.',
    acceptanceCriteria: ['Given data, when I export, then a CSV file downloads.'],
  };
  const findings = runRuleChecks(story);
  assert.ok(findings.some((f) => /so that/i.test(f.message)));
});

test('flags a story missing the actor/goal pattern', () => {
  const story: UserStory = {
    id: 'T',
    title: 'Malformed',
    story: 'The system exports data.',
    acceptanceCriteria: ['Given data, when I export, then a CSV file downloads.'],
  };
  const findings = runRuleChecks(story);
  assert.ok(findings.some((f) => f.category === 'structure' && /As a/i.test(f.message)));
});

test('flags duplicate acceptance criteria exactly once', () => {
  const story: UserStory = {
    id: 'T',
    title: 'Dupes',
    story: 'As a user, I want X so that Y.',
    acceptanceCriteria: [
      'Given a, when b, then an error c is shown.',
      'Given a, when b, then an error c is shown.',
    ],
  };
  const dupes = runRuleChecks(story).filter((f) => /duplicate/i.test(f.message));
  assert.equal(dupes.length, 1);
});

test('scoreClarity applies severity weights', () => {
  const findings: Finding[] = [
    { category: 'testability', severity: 'high', message: 'h' },
    { category: 'ambiguity', severity: 'medium', message: 'm' },
    { category: 'structure', severity: 'low', message: 'l' },
  ];
  // 100 - (20 + 8 + 3) = 69
  assert.equal(scoreClarity(findings), 69);
});

test('scoreClarity never drops below zero', () => {
  const many: Finding[] = Array.from({ length: 10 }, () => ({
    category: 'testability' as const,
    severity: 'high' as const,
    message: 'h',
  }));
  assert.equal(scoreClarity(many), 0);
});

test('a perfect story scores 100', () => {
  assert.equal(scoreClarity(runRuleChecks(cleanStory)), 100);
});

test('flawed story surfaces multiple finding categories', () => {
  const cats = new Set(categories(runRuleChecks(flawedStory)));
  assert.ok(cats.size >= 2);
});
