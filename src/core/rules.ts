import type { Finding, UserStory } from './types.js';

/**
 * Deterministic, rule-based checks inspired by functional analysis
 * practice. These run with no external dependency and encode common
 * requirement smells a QA/analyst would flag in refinement.
 *
 * Every pattern below is compiled once at module load: the checks run
 * per criterion, so building them inside the loops recompiled dozens of
 * regexes per story for no benefit.
 */

/**
 * Vague words that signal ambiguity and resist objective testing.
 *
 * Word forms are listed explicitly rather than derived with a suffix
 * pattern: `\befficient\b` does not match "efficiently", but a blanket
 * `(?:ly|s)?` suffix would turn "good" into a match for "goods".
 */
const AMBIGUOUS_TERMS = [
  'fast', 'slow', 'slowly', 'quick', 'quickly',
  'efficient', 'efficiently', 'user-friendly', 'intuitive', 'intuitively',
  'appropriate', 'appropriately', 'reasonable', 'reasonably',
  'proper', 'properly', 'optimal', 'optimally',
  'etc', 'and so on', 'as needed',
  'good', 'bad', 'soon', 'several', 'some', 'many', 'few',
];

/**
 * Terms hinting that a quantitative threshold is missing. These are only
 * flagged next to a noun that can actually carry a number: on its own,
 * "high" is just as often a legitimate qualifier ("a high-priority order")
 * as a missing threshold ("a high number of requests").
 */
const UNMEASURED_TERMS = [
  'large', 'small', 'high', 'low', 'long', 'short', 'heavy', 'huge', 'tiny',
];

/** Nouns that imply a measurable quantity. */
const QUANTITATIVE_NOUNS = [
  'number', 'amount', 'volume', 'load', 'traffic', 'latency', 'delay',
  'time', 'duration', 'size', 'list', 'set', 'dataset', 'count', 'quantity',
  'threshold', 'limit', 'capacity', 'throughput', 'payload', 'timeout',
  'interval', 'period', 'frequency', 'rate', 'file', 'files',
];

/**
 * Weak modal verbs that turn a requirement into an aspiration: they leave
 * it unclear whether the behaviour is mandatory, so it can't be verified.
 * ("should" is deliberately excluded — it is too common in well-formed
 * criteria to flag without generating noise.)
 */
const WEAK_MODAL_TERMS = ['could', 'may', 'might', 'possibly', 'ideally', 'preferably'];

interface TermPattern {
  readonly term: string;
  readonly pattern: RegExp;
}

function wordPatterns(terms: readonly string[]): TermPattern[] {
  return terms.map((term) => ({ term, pattern: new RegExp(`\\b${term}\\b`) }));
}

const AMBIGUOUS_PATTERNS = wordPatterns(AMBIGUOUS_TERMS);
const WEAK_MODAL_PATTERNS = wordPatterns(WEAK_MODAL_TERMS);

const NOUNS = QUANTITATIVE_NOUNS.join('|');

/**
 * Two shapes carry an implied threshold:
 *   "a large number of products"      — term before the noun
 *   "the response time should be short" — noun before the term
 */
const UNMEASURED_PATTERNS: TermPattern[] = UNMEASURED_TERMS.map((term) => ({
  term,
  pattern: new RegExp(
    `\\b${term}\\b(?:\\s+[\\w-]+){0,2}\\s+(?:${NOUNS})\\b` +
      `|\\b(?:${NOUNS})\\b(?:\\s+[\\w-]+){0,3}?\\s+(?:is|are|be|stays?|remains?)\\s+(?:very\\s+)?${term}\\b`,
  ),
}));

/**
 * Given/When/Then must appear in that order and as whole words — a plain
 * substring check passes "forgiven ... whenever ... then" and accepts the
 * three keywords in any order.
 */
const GIVEN_WHEN_THEN = /\bgiven\b[\s\S]*?\bwhen\b[\s\S]*?\bthen\b/;

function hasGivenWhenThen(criterion: string): boolean {
  return GIVEN_WHEN_THEN.test(criterion.toLowerCase());
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
    // A blank entry is a placeholder nobody filled in — reporting only
    // "not in Given/When/Then form" would bury the real problem.
    if (criterion.trim() === '') {
      findings.push({
        category: 'testability',
        severity: 'high',
        message: 'Empty acceptance criterion — remove the placeholder or describe the expectation.',
        criterion,
      });
      continue;
    }

    const lower = criterion.toLowerCase();

    for (const { term, pattern } of AMBIGUOUS_PATTERNS) {
      if (pattern.test(lower)) {
        findings.push({
          category: 'ambiguity',
          severity: 'medium',
          message: `Ambiguous term "${term}" — replace with an objective, testable expectation.`,
          criterion,
        });
      }
    }

    for (const { term, pattern } of UNMEASURED_PATTERNS) {
      if (pattern.test(lower)) {
        findings.push({
          category: 'measurability',
          severity: 'medium',
          message: `"${term}" implies a threshold but none is given — specify a measurable value.`,
          criterion,
        });
      }
    }

    for (const { term, pattern } of WEAK_MODAL_PATTERNS) {
      if (pattern.test(lower)) {
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

const WEIGHTS = { high: 20, medium: 8, low: 3 } as const;

/**
 * Heuristic clarity score: 100 minus weighted penalties.
 *
 * Findings that belong to a specific criterion are averaged over the number
 * of criteria; only story-level findings count in full. Summing everything
 * absolutely made the score a function of story length — twenty well-written
 * criteria that merely skipped Given/When/Then scored 40, while a single
 * terrible criterion scored 81. Averaging makes the score mean "how good is
 * a typical criterion here", which is comparable across stories.
 *
 * @param criteriaCount number of acceptance criteria the findings came from.
 */
export function scoreClarity(findings: readonly Finding[], criteriaCount = 1): number {
  const divisor = Math.max(1, criteriaCount);

  let storyPenalty = 0;
  let criterionPenalty = 0;
  for (const finding of findings) {
    const weight = WEIGHTS[finding.severity];
    if (finding.criterion === undefined) storyPenalty += weight;
    else criterionPenalty += weight;
  }

  return Math.max(0, Math.round(100 - storyPenalty - criterionPenalty / divisor));
}
