import type { AnalysisReport, UserStory } from './core/types.js';
import { runRuleChecks, scoreClarity } from './core/rules.js';
import { enrichWithAi } from './ai/enrich.js';

/**
 * Runs the deterministic rules and, when available, the AI layer,
 * merging both into a single report.
 */
export async function analyzeStory(story: UserStory): Promise<AnalysisReport> {
  const ruleFindings = runRuleChecks(story);
  const aiFindings = await enrichWithAi(story);
  const findings = [...ruleFindings, ...aiFindings];

  return {
    storyId: story.id,
    findings,
    clarityScore: scoreClarity(findings, story.acceptanceCriteria.length),
  };
}
