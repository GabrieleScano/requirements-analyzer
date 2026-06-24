# Requirements Analyzer

A command-line tool that reviews **user stories and acceptance criteria** for ambiguities, missing edge cases and testability problems — the kind of issues a QA engineer or functional analyst raises during backlog refinement.

[![CI](https://github.com/GabrieleScano/requirements-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/GabrieleScano/requirements-analyzer/actions/workflows/ci.yml)

## Why this project

Shift-left testing starts before any code is written: the cheapest defect to fix is an ambiguous requirement. This tool turns that practice into something concrete and repeatable.

It combines two layers:

1. **Deterministic rule engine** — no dependencies, fully offline. Flags vague language, unmeasured thresholds, missing negative paths and criteria that aren't in Given/When/Then form. Produces a clarity score.
2. **Optional AI layer** — when an API key is available, adds semantic findings the rules can't catch: logical contradictions, implicit assumptions, undefined business terms, missing flows.

The rule engine is the source of truth; AI is additive and best-effort (a network error never breaks the analysis).

## Usage

```bash
npm ci
npm start examples/login-story.json
```

Example output:

```
Requirements analysis — story SEARCH-7
================================================
Clarity score: 61/100

4 finding(s):

[MEDIUM] (ambiguity) Ambiguous term "fast" — replace with an objective, testable expectation.
           ↳ "The search should be fast and return relevant results."
[MEDIUM] (measurability) "large" implies a threshold but none is given — specify a measurable value.
           ↳ "Results should handle a large number of products efficiently."
[HIGH]   (missing-edge-case) No negative or error path described — consider invalid input, empty values and failure handling.
...
```

Compare a clean story:

```bash
npm start examples/good-story.json
```

## Use as a CI gate

The CLI exits with a non-zero code when high-severity issues are found, so it can fail a pipeline on poorly specified requirements:

```yaml
- run: npx tsx src/cli.ts requirements/new-feature.json
```

## Enabling the AI layer

```bash
cp .env.example .env   # add ANTHROPIC_API_KEY
npm start examples/login-story.json
```

## Project structure

```
src/
  core/      # types + deterministic rule engine (pure functions)
  ai/        # optional AI enrichment layer
  analyzer.ts# orchestration
  cli.ts     # CLI + formatted output
tests/       # unit tests for the rule engine
examples/    # sample stories (one flawed, one clean)
```

## Testing

```bash
npm test          # unit tests (node:test)
npx tsc --noEmit  # type-check
```

## License

MIT
