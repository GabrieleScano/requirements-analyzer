import type { Finding, UserStory } from './types.js';

/**
 * Deterministic, rule-based checks inspired by functional analysis
 * practice. These run with no external dependency and encode common
 * requirement smells a QA/analyst would flag in refinement.
 */

/** Vague words that signal ambiguity and resist objective testing. */
const AMBIGUOUS_TERMS = [
  'fast', 'slow', 'quickly', 'efficient', 'user-friendly', 'intuitive',
  'appropriate', 'reasonable', 'etc', 'and so on', 'as needed', 'properly',
  'good', 'bad', 'soon', 'several', 'some', 'many', 'few', 'optimal',
];

/** Terms hinting that a quantitative threshold is missing. */
const UNMEASURED_TERMS = ['large', 'small', 'high', 'low', 'long', 'short', 'heavy'];

/**
 * Weak modal verbs that turn a requirement into an aspiration: they leave
 * it unclear whether the behaviour is mandatory, so it can't be verified.
 * ("should" is deliberately excluded — it is too common in well-formed
 * criteria to flag without generating noise.)
 */
const WEAK_MODAL_TERMS = ['could', 'may', 'might', 'possibly', 'ideally', 'preferably'];

function hasGivenWhenThen(criterion: string): boolean {
  const lower = criterion.toLowerCase();
  return lower.includes('given') && lower.includes('when') && lower.includes('then');
}

/** Normalize a criterion for duplicate detection: lowercase, collapse whitespace. */
function normalize(criterion: string): string {
  return criterion.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function runRuleChecks(story: UserStory): Finding[] {
  const findings: Finding[] = [];

  // Story-level: well-formed "As a / I want / so that".
  const storyLower = story.story.toLowerCase();
  if (!storyLower.includes('as a') || !storyLower.includes('i want')) {
    findings.push({
      category: 'structure',
      severity: 'low',
      message:
        'Story does not follow the "As a..., I want..., so that..." pattern, making the actor or goal unclear.',
    });
  } else if (!storyLower.includes('so that')) {
    // Actor and goal are present, but the motivation ("so that...") is missing.
    findings.push({
      category: 'structure',
      severity: 'low',
      message:
        'Story states the goal but not the benefit ("so that..."), making it hard to judge what success delivers.',
    });
  }

  // No acceptance criteria at all.
  if (story.acceptanceCriteria.length === 0) {
    findings.push({
      category: 'testability',
      severity: 'high',
      message: 'No acceptance criteria provided — the story cannot be objectively verified.',
    });
    return findings;
  }

  for (const criterion of story.acceptanceCriteria) {
    const lower = criterion.toLowerCase();

    for (const term of AMBIGUOUS_TERMS) {
      if (new RegExp(`\\b${term}\\b`).test(lower)) {
        findings.push({
          category: 'ambiguity',
          severity: 'medium',
          message: `Ambiguous term "${term}" — replace with an objective, testable expectation.`,
          criterion,
        });
      }
    }

    for (const term of UNMEASURED_TERMS) {
      if (new RegExp(`\\b${term}\\b`).test(lower)) {
        findings.push({
          category: 'measurability',
          severity: 'medium',
          message: `"${term}" implies a threshold but none is given — specify a measurable value.`,
          criterion,
        });
      }
    }

    for (const term of WEAK_MODAL_TERMS) {
      if (new RegExp(`\\b${term}\\b`).test(lower)) {
        findings.push({
          category: 'testability',
          severity: 'low',
          message: `Weak modal "${term}" — state whether the behaviour is required, so it can be verified.`,
          criterion,
        });
      }
    }

    if (!hasGivenWhenThen(criterion)) {
      findings.push({
        category: 'structure',
        severity: 'low',
        message:
          'Criterion is not in Given/When/Then form, which can hide preconditions or expected outcomes.',
        criterion,
      });
    }
  }

  // Duplicate acceptance criteria add noise and hint at copy-paste drift.
  const seen = new Set<string>();
  const flaggedDuplicates = new Set<string>();
  for (const criterion of story.acceptanceCriteria) {
    const key = normalize(criterion);
    if (seen.has(key) && !flaggedDuplicates.has(key)) {
      flaggedDuplicates.add(key);
      findings.push({
        category: 'structure',
        severity: 'low',
        message: 'Duplicate acceptance criterion — remove the repetition or clarify the difference.',
        criterion,
      });
    }
    seen.add(key);
  }

  // Heuristic: error/negative paths often forgotten.
  const mentionsError = story.acceptanceCriteria.some((c) =>
    /error|invalid|fail|reject|empty|missing/i.test(c),
  );
  if (!mentionsError) {
    findings.push({
      category: 'missing-edge-case',
      severity: 'high',
      message:
        'No negative or error path described — consider invalid input, empty values and failure handling.',
    });
  }

  return findings;
}

/**
 * Heuristic clarity score: starts at 100 and subtracts weighted
 * penalties per finding severity.
 */
export function scoreClarity(findings: readonly Finding[]): number {
  const weights = { high: 20, medium: 8, low: 3 } as const;
  const penalty = findings.reduce((sum, f) => sum + weights[f.severity], 0);
  return Math.max(0, 100 - penalty);
}
