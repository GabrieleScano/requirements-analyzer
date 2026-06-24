#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { analyzeStory } from './analyzer.js';
import type { AnalysisReport, Severity, UserStory } from './core/types.js';

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'HIGH  ',
  medium: 'MEDIUM',
  low: 'LOW   ',
};

function printReport(report: AnalysisReport): void {
  console.log(`\nRequirements analysis — story ${report.storyId}`);
  console.log('='.repeat(48));
  console.log(`Clarity score: ${report.clarityScore}/100\n`);

  if (report.findings.length === 0) {
    console.log('No issues detected. Criteria look clear and testable.');
    return;
  }

  console.log(`${report.findings.length} finding(s):\n`);
  for (const f of report.findings) {
    console.log(`[${SEVERITY_LABEL[f.severity]}] (${f.category}) ${f.message}`);
    if (f.criterion) {
      console.log(`           ↳ "${f.criterion}"`);
    }
  }
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: reqcheck <path-to-story.json>');
    process.exitCode = 1;
    return;
  }

  const raw = readFileSync(path, 'utf-8');
  const story = JSON.parse(raw) as UserStory;
  const report = await analyzeStory(story);
  printReport(report);

  // Non-zero exit when high-severity issues exist: usable as a CI gate.
  const hasHigh = report.findings.some((f) => f.severity === 'high');
  if (hasHigh) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error('Analysis failed:', error);
  process.exitCode = 1;
});
