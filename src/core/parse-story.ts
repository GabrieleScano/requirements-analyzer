import type { UserStory } from './types.js';

/**
 * Runtime validation for story files.
 *
 * A `JSON.parse(...) as UserStory` cast is a lie: it silently accepts any
 * shape and lets the failure surface later as an unreadable TypeError deep
 * in the rule engine. A tool whose whole job is to reject under-specified
 * input should reject its own malformed input just as clearly.
 */
export class StoryValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid story file:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'StoryValidationError';
    this.problems = problems;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate a non-empty string field, collecting a problem when it fails. */
function requireString(
  source: Record<string, unknown>,
  field: string,
  problems: string[],
): string {
  const value = source[field];
  if (typeof value !== 'string') {
    problems.push(`"${field}" is required and must be a string (got ${describe(value)}).`);
    return '';
  }
  if (value.trim() === '') {
    problems.push(`"${field}" must not be empty.`);
  }
  return value;
}

/** A short, human-readable description of an unexpected value. */
function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

/**
 * Parse raw JSON text into a `UserStory`, throwing `StoryValidationError`
 * with every problem found rather than only the first.
 */
export function parseStory(raw: string): UserStory {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new StoryValidationError([`File is not valid JSON (${detail}).`]);
  }

  if (!isRecord(data)) {
    throw new StoryValidationError([
      `Expected a JSON object with id, title, story and acceptanceCriteria (got ${describe(data)}).`,
    ]);
  }

  const problems: string[] = [];
  const id = requireString(data, 'id', problems);
  const title = requireString(data, 'title', problems);
  const story = requireString(data, 'story', problems);

  const rawCriteria = data['acceptanceCriteria'];
  let acceptanceCriteria: string[] = [];
  if (!Array.isArray(rawCriteria)) {
    problems.push(
      `"acceptanceCriteria" is required and must be an array of strings (got ${describe(rawCriteria)}).`,
    );
  } else {
    rawCriteria.forEach((criterion, index) => {
      if (typeof criterion !== 'string') {
        problems.push(`acceptanceCriteria[${index}] must be a string (got ${describe(criterion)}).`);
      }
    });
    acceptanceCriteria = rawCriteria.filter((c): c is string => typeof c === 'string');
  }

  if (problems.length > 0) throw new StoryValidationError(problems);

  return { id, title, story, acceptanceCriteria };
}
