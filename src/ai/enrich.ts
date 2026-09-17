import {
  FINDING_CATEGORIES,
  SEVERITIES,
  isFindingCategory,
  isSeverity,
  type Finding,
  type UserStory,
} from '../core/types.js';

/**
 * Optional AI layer. When an API key is present, it complements the
 * deterministic rules with semantic findings the regex checks cannot
 * catch (logical contradictions, implicit assumptions, missing flows).
 *
 * The deterministic engine remains the source of truth; AI is additive
 * and strictly best-effort — every failure mode below returns `[]` rather
 * than propagating, so the rule findings are always reported.
 */
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5';

/**
 * Wall-clock ceiling for the whole request. Without it an unresponsive
 * endpoint hangs the analysis indefinitely — fatal when the CLI is used
 * as a CI gate. Generous enough to cover adaptive thinking on Opus.
 */
const REQUEST_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = `You are a senior functional analyst reviewing a user story for testability.
Identify issues a rule-based linter would miss: logical contradictions, implicit assumptions,
undefined business terms, missing alternative flows, and dependencies between criteria.
Report only substantive issues; return an empty list when the story is sound.`;

/**
 * Structured outputs constrain the response to this schema server-side,
 * which replaces the old "respond with STRICT JSON only" prompt plea.
 */
const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: FINDING_CATEGORIES },
          severity: { type: 'string', enum: SEVERITIES },
          message: { type: 'string' },
        },
        required: ['category', 'severity', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
} as const;

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
}

/**
 * Keep only findings that match the domain types.
 *
 * The schema makes a malformed response unlikely, not impossible: the
 * request can be served without schema enforcement, truncated by
 * `max_tokens`, or stopped by a refusal. An unchecked `parsed.findings`
 * reached the caller as `undefined` (breaking the spread in the analyzer)
 * or carried an unknown severity (turning the clarity score into `NaN`),
 * so validate here rather than trusting the shape.
 */
function sanitizeFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];

  const findings: Finding[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { category, severity, message } = entry as Record<string, unknown>;
    if (!isFindingCategory(category)) continue;
    if (!isSeverity(severity)) continue;
    if (typeof message !== 'string' || message.trim() === '') continue;
    findings.push({ category, severity, message });
  }
  return findings;
}

export async function enrichWithAi(story: UserStory): Promise<Finding[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return [];

  const userPrompt = [
    `Story: ${story.story}`,
    'Acceptance criteria:',
    ...story.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
  ].join('\n');

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      }),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as AnthropicResponse;
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      // Defensive: structured outputs return bare JSON, but a response
      // served without schema enforcement may still arrive fenced.
      .replace(/```json|```/g, '')
      .trim();

    if (text === '') return [];

    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return [];
    return sanitizeFindings((parsed as Record<string, unknown>)['findings']);
  } catch {
    // AI is best-effort: never break the analysis on a network error,
    // a timeout, or an unparseable body.
    return [];
  }
}
