/**
 * Domain types for the requirements analyzer.
 */

export interface UserStory {
  readonly id: string;
  readonly title: string;
  readonly story: string;
  readonly acceptanceCriteria: readonly string[];
}

export type Severity = 'high' | 'medium' | 'low';

export type FindingCategory =
  | 'ambiguity'
  | 'missing-edge-case'
  | 'testability'
  | 'measurability'
  | 'structure';

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
