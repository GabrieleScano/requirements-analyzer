# Requirements Analyzer

A command-line tool that reviews **user stories and acceptance criteria** for ambiguities, missing edge cases and testability problems — the kind of issues a QA engineer or functional analyst raises during backlog refinement.

[![CI](https://github.com/GabrieleScano/requirements-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/GabrieleScano/requirements-analyzer/actions/workflows/ci.yml)

## Why this project

Shift-left testing starts before any code is written: the cheapest defect to fix is an ambiguous requirement. This tool turns that practice into something concrete and repeatable.

It combines two layers:

1. **Deterministic rule engine** — no dependencies, fully offline. Flags vague language, unmeasured thresholds, missing negative paths and criteria that aren't in Given/When/Then form. Produces a clarity score.
2. **Optional AI layer** — when an API key is available, adds semantic findings the rules can't catch: logical contradictions, implicit assumptions, undefined business terms, missing flows.

The rule engine is the source of truth; AI is additive and best-effort. A network error, a timeout or a malformed model response all degrade to "no AI findings" — never to a failed analysis.

## Usage

```bash
npm ci
npm start examples/search-story.json
```

Example output:

```
Requirements analysis — story SEARCH-7
================================================
Clarity score: 69/100

7 finding(s):

[MEDIUM] (ambiguity) Ambiguous term "fast" — replace with an objective, testable expectation.
           ↳ "The search should be fast and return relevant results."
[LOW   ] (structure) Criterion is not in Given/When/Then form, which can hide preconditions or expected outcomes.
           ↳ "The search should be fast and return relevant results."
[LOW   ] (structure) Criterion is not in Given/When/Then form, which can hide preconditions or expected outcomes.
           ↳ "When I type a query, then matching products are shown."
[MEDIUM] (ambiguity) Ambiguous term "efficiently" — replace with an objective, testable expectation.
           ↳ "Results should handle a large number of products efficiently."
[MEDIUM] (measurability) "large" implies a threshold but none is given — specify a measurable value.
           ↳ "Results should handle a large number of products efficiently."
[LOW   ] (structure) Criterion is not in Given/When/Then form, which can hide preconditions or expected outcomes.
           ↳ "Results should handle a large number of products efficiently."
[HIGH  ] (missing-edge-case) No negative or error path described — consider invalid input, empty values and failure handling.
```

Compare a clean story:

```bash
npm start examples/good-story.json
```

## Options

```
reqcheck [options] <story.json> [...more.json]

  --json               Emit machine-readable JSON instead of formatted text.
  --fail-on <level>    Exit with code 2 when a finding of this severity or
                       worse is present: high (default), medium, low, none.
  -h, --help           Show this help.
  -V, --version        Show the version.
```

Exit codes: `0` clean, `1` usage error or invalid story file, `2` findings at or above the threshold.

## Use as a CI gate

The CLI exits with a non-zero code when findings reach the threshold, so it can fail a pipeline on poorly specified requirements:

```yaml
- run: npx tsx src/cli.ts requirements/*.json
```

Tighten or relax the gate with `--fail-on`, and feed the results to another tool with `--json`:

```bash
npx tsx src/cli.ts --json --fail-on medium requirements/*.json > analysis.json
```

The JSON shape is stable:

```json
{
  "reports": [
    {
      "storyId": "SEARCH-7",
      "clarityScore": 69,
      "findings": [
        {
          "category": "ambiguity",
          "severity": "medium",
          "message": "Ambiguous term \"fast\" — ...",
          "criterion": "The search should be fast and return relevant results."
        }
      ]
    }
  ]
}
```

## The clarity score

The score starts at 100 and subtracts weighted penalties (high 20, medium 8, low 3).

Findings tied to a specific criterion are **averaged over the number of criteria**; only story-level findings (a missing negative path, a malformed story sentence) count in full. Without that, the score measured story length as much as story quality — twenty well-written criteria that merely skipped Given/When/Then scored worse than a single unusable one. As it stands, the score answers "how good is a typical criterion here", and is comparable across stories of different sizes.

## Input format

```json
{
  "id": "SEARCH-7",
  "title": "Product search",
  "story": "As a shopper, I want to search for products so that I can find what I need.",
  "acceptanceCriteria": ["..."]
}
```

All four fields are required; `acceptanceCriteria` must be an array of strings. Invalid files are rejected with every problem listed at once, not a stack trace.

## Enabling the AI layer

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY
npm start examples/search-story.json
```

The `.env` file is resolved against the **current working directory**, so an installed `reqcheck` binary run from elsewhere will not find this repository's copy — export `ANTHROPIC_API_KEY` in the environment for that case. An already-defined variable always takes precedence over the file.

Requests carry a 60-second timeout and constrain the response with a JSON schema (`output_config.format`), so an unresponsive endpoint or an off-schema answer costs the run nothing but the AI findings.

## Project structure

```
src/
  core/      # types, story validation + deterministic rule engine (pure functions)
  ai/        # optional AI enrichment layer
  analyzer.ts# orchestration
  cli.ts     # CLI, argument parsing + formatted output
tests/       # unit tests for the rules, validation, AI layer and CLI
examples/    # sample stories (one flawed, one clean)
```

## Testing

```bash
npm test           # unit tests (node:test)
npm run typecheck  # type-checks src/ and tests/ together
npm run build      # compiles to dist/
```

## License

MIT
