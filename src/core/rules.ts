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
  'etc', 'and so on', 'as needed', 'as expected',
  'good', 'bad', 'soon', 'several', 'some', 'many', 'few',
  'correctly', 'easy', 'easily', 'nice', 'nicely', 'robust',
  'seamless', 'seamlessly', 'smooth', 'smoothly', 'work well', 'works well',
];

/**
 * Speed words stop being vague once the criterion pins them to a time
 * budget: "loads fast, within 200 ms" is measurable, so flagging "fast"
 * there would punish the author for doing the right thing.
 */
const SPEED_TERMS: ReadonlySet<string> = new Set(['fast', 'slow', 'slowly', 'quick', 'quickly', 'soon']);
const TIME_BUDGET = /\d\s*(?:ms|milliseconds?|s|secs?|seconds?|mins?|minutes?|hours?|days?)\b/;

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

/**
 * Story sentence parts, matched as whole words: a substring check for
 * "as a" accepted "the page has a button" and rejected "As the owner".
 */
const STORY_ACTOR = /\bas (?:a|an|the)\b/;
const STORY_GOAL = /\bi (?:want|need|would like)\b|\bi'd like\b/;
const STORY_BENEFIT = /\bso that\b/;

/**
 * A capitalised "May" in the middle of a sentence is the month, not the
 * modal ("a booking in May"). Drop it before the weak-modal check, which
 * otherwise runs on lowercased text and cannot tell the two apart.
 */
const MONTH_OF_MAY = /([^.!?\s]\s+)May\b/g;

/**
 * In a Given clause "some" only sets the scene ("Given some items in the
 * cart"); it is vague where it describes the action or the outcome.
 */
const GIVEN_CLAUSE = /\bgiven\b[\s\S]*?(?=\bwhen\b)/;

/** Fewer words than this cannot state both a condition and an outcome. */
const MIN_CRITERION_WORDS = 3;

/**
 * Whole words only — a substring check counted "failover" as a failure
 * path.
 */
const NEGATIVE_PATH =
  /\b(?:errors?|invalid|fail(?:s|ed|ing|ure|ures)?|reject(?:s|ed|ion)?|empty|missing|denied|unauthori[sz]ed|not found|cannot|unable)\b/i;

/** Normalize a criterion for duplicate detection: lowercase, collapse whitespace. */
function normalize(criterion: string): string {
  return criterion.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function runRuleChecks(story: UserStory): Finding[] {
  const findings: Finding[] = [];

  // Story-level: well-formed "As a / I want / so that".
  const storyLower = story.story.toLowerCase();
  if (!STORY_ACTOR.test(storyLower) || !STORY_GOAL.test(storyLower)) {
    findings.push({
      category: 'structure',
      severity: 'low',
      message:
        'Story does not follow the "As a..., I want..., so that..." pattern, making the actor or goal unclear.',
    });
  } else if (!STORY_BENEFIT.test(storyLower)) {
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

    // Too short to describe a verifiable expectation ("Login works.").
    if (criterion.trim().split(/\s+/).length < MIN_CRITERION_WORDS) {
      findings.push({
        category: 'testability',
        severity: 'high',
        message:
          'Criterion is too short to state a verifiable expectation — describe the condition and the expected outcome.',
        criterion,
      });
    }

    const hasTimeBudget = TIME_BUDGET.test(lower);
    const withoutGivenClause = hasGivenWhenThen(criterion) ? lower.replace(GIVEN_CLAUSE, '') : lower;

    for (const { term, pattern } of AMBIGUOUS_PATTERNS) {
      if (hasTimeBudget && SPEED_TERMS.has(term)) continue;
      if (pattern.test(term === 'some' ? withoutGivenClause : lower)) {
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

    const modalText = criterion.replace(MONTH_OF_MAY, '$1').toLowerCase();
    for (const { term, pattern } of WEAK_MODAL_PATTERNS) {
      if (pattern.test(modalText)) {
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
        severity: 'medium',
        message: 'Duplicate acceptance criterion — remove the repetition or clarify the difference.',
        criterion,
      });
    }
    seen.add(key);
  }

  // Heuristic: error/negative paths often forgotten.
  const mentionsError = story.acceptanceCriteria.some((c) => NEGATIVE_PATH.test(c));
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

/** A story with nothing to verify cannot score above this. */
const NO_CRITERIA_CEILING = 40;

/**
 * Heuristic clarity score: 100 minus weighted penalties.
 *
 * Story-level findings count in full. Findings that belong to a specific
 * criterion are scored as the midpoint between the average criterion and
 * the worst one:
 *
 * - Summing them absolutely made the score a function of story length —
 *   twenty well-written criteria that merely skipped Given/When/Then scored
 *   40, while a single terrible criterion scored 81.
 * - Averaging alone let good criteria hide a bad one — an unusable criterion
 *   scored 54 on its own and 95 next to nine clean ones, although it still
 *   blocks the story.
 *
 * A story without acceptance criteria is capped at NO_CRITERIA_CEILING: it
 * produces a single finding, but there is nothing to verify at all.
 *
 * @param criteriaCount number of acceptance criteria the findings came from.
 */
export function scoreClarity(findings: readonly Finding[], criteriaCount = 1): number {
  const divisor = Math.max(1, criteriaCount);

  let storyPenalty = 0;
  let criterionTotal = 0;
  // Per-criterion penalty, counting each distinct finding once: a criterion
  // repeated verbatim reports the same findings once per copy.
  const perCriterion = new Map<string, number>();
  const counted = new Set<string>();
  for (const finding of findings) {
    const weight = WEIGHTS[finding.severity];
    if (finding.criterion === undefined) {
      storyPenalty += weight;
      continue;
    }
    criterionTotal += weight;
    const key = `${finding.criterion}\u0000${finding.message}`;
    if (!counted.has(key)) {
      counted.add(key);
      perCriterion.set(finding.criterion, (perCriterion.get(finding.criterion) ?? 0) + weight);
    }
  }

  const worst = Math.max(0, ...perCriterion.values());
  const criterionPenalty = (criterionTotal / divisor + worst) / 2;
  const ceiling = criteriaCount === 0 ? NO_CRITERIA_CEILING : 100;

  return Math.max(0, Math.min(ceiling, Math.round(100 - storyPenalty - criterionPenalty)));
}
