/**
 * Domain types for the requirements analyzer.
 */

export interface UserStory {
  readonly id: string;
  readonly title: string;
  readonly story: string;
  readonly acceptanceCriteria: readonly string[];
}

/**
 * Severity levels, ordered from most to least serious. Exported as a const
 * tuple so both the runtime validators and the CLI threshold parsing can
 * share a single source of truth with the `Severity` type.
 */
export const SEVERITIES = ['high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FINDING_CATEGORIES = [
  'ambiguity',
  'missing-edge-case',
  'testability',
  'measurability',
  'structure',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export interface Finding {
  readonly category: FindingCategory;
  readonly severity: Severity;
  readonly message: string;
  /** The criterion the finding relates to, when applicable. */
  readonly criterion?: string;
}

export interface AnalysisReport {
  readonly storyId: string;
  readonly findings: readonly Finding[];
  /** 0-100 heuristic score; higher means clearer, more testable. */
  readonly clarityScore: number;
}

export function isSeverity(value: unknown): value is Severity {
  return typeof value === 'string' && (SEVERITIES as readonly string[]).includes(value);
}

export function isFindingCategory(value: unknown): value is FindingCategory {
  return typeof value === 'string' && (FINDING_CATEGORIES as readonly string[]).includes(value);
}
