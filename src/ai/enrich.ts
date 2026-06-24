import type { Finding, UserStory } from '../core/types.js';

/**
 * Optional AI layer. When an API key is present, it complements the
 * deterministic rules with semantic findings the regex checks cannot
 * catch (logical contradictions, implicit assumptions, missing flows).
 *
 * The deterministic engine remains the source of truth; AI is additive.
 */
const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are a senior functional analyst reviewing a user story for testability.
Identify issues a rule-based linter would miss: logical contradictions, implicit assumptions,
undefined business terms, missing alternative flows, and dependencies between criteria.
Respond with STRICT JSON only:
{
  "findings": [
    {
      "category": "ambiguity" | "missing-edge-case" | "testability" | "measurability" | "structure",
      "severity": "high" | "medium" | "low",
      "message": string
    }
  ]
}`;

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
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
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) return [];

    const data = (await response.json()) as AnthropicResponse;
    const text = data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    const parsed = JSON.parse(text) as { findings: Finding[] };
    return parsed.findings;
  } catch {
    // AI is best-effort: never break the analysis on a network error.
    return [];
  }
}
