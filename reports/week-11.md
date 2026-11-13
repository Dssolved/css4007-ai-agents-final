# Semester Week 11 Progress Report

## Completed Work

- **Provider-neutral model client** (`src/llm/`): one OpenAI-compatible chat-completions client that works with the Gemini API, OpenRouter and OpenAI by base URL. It sends messages and tool schemas and returns a validated `ModelReply` (text, tool calls, token usage, finish reason).
- **Response validation** (`src/llm/parse.ts`): missing choices, non-text content, tool calls without a name and malformed JSON arguments become a typed `ModelError('invalid_response')` instead of a crash.
- **Error handling** (`src/llm/client.ts`): per-attempt timeout; retries with backoff for 429 / 5xx / timeouts / network errors, honouring `Retry-After`; no retry for 401/403 and other 4xx; the API key never appears in error messages.
- **First working request with tool calling** (`npm run first-request`): two read tools (`get_sleep`, `get_plan`) over a tiny fictional day; the model decides which tools to call, the program runs them and sends the results back, and the model answers from them.
- **Configuration** (`src/config.ts`): one key per provider (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`) and a default `LLM_PROVIDER` / `LLM_MODEL`, read from a git-ignored `.env`.
- **Model comparison experiment** (`npm run compare-models`): 7 models × 6 cases scored by code. Results in `reports/experiments/week-11-models.md` (run 2) and `week-11-models-run1.md` (run 1, kept on purpose).
- **TypeScript type checking** (`npm run typecheck`, `tsc` as a dev dependency) and 8 new tests for the client (20 in total, all offline).

## Important Commits

- Commit hash: 8623591
- Description: OpenAI-compatible model client with retries, timeouts and response validation; first tool-calling request; tests
- Link: https://github.com/Dssolved/css4007-ai-agents-final/commit/8623591

- Commit hash: 91c5c6a
- Description: model comparison experiment (7 models, 6 code-scored cases), one key per provider, proposal revision
- Link: https://github.com/Dssolved/css4007-ai-agents-final/commit/91c5c6a

## Current Functionality

The application can ask a real model a question about the fictional person's day; the model selects tools itself (`get_sleep`, `get_plan`), the results are returned to it and it answers from them, saying so when data is missing instead of inventing it. Any of three providers can be used by changing `.env`. Model failures are classified (`auth`, `rate_limit`, `server`, `timeout`, `network`, `bad_request`, `invalid_response`, `config`) and retried only when retrying makes sense.

Model comparison, run 2 (6 cases: last night's sleep, yesterday's plan, no-tool greeting, two tools in one question, missing data, an instruction to ignore the tools):

| Model | Passed | Median latency | Est. cost of all 6 cases |
|---|---|---|---|
| gemini-3.5-flash-lite (free tier) | 6/6 | 8.0 s (1.8 s in run 1) | free ($0.0019 on a paid tier) |
| gemini-3.8-flash (free tier) | 0/6 — 503 "high demand", then 429 quota | — | — |
| gpt-5.4-nano | 6/6 | 2.2 s | $0.0011 |
| gpt-5.4-mini | 6/6 | 1.9 s | $0.0036 |
| deepseek-v4-flash (OpenRouter) | 6/6 | 5.3 s | $0.0006 |
| qwen3.8-flash (OpenRouter) | 5/6 | 7.6 s | $0.0021 |
| claude-haiku-5.5 (OpenRouter) | 6/6 | 2.3 s | $0.0012 |

Decision: **gemini-3.5-flash-lite** (free) as the default for development; **gpt-5.4-nano** as the paid fallback when the free tier is slow or rate-limited. The final choice for the live evaluation is revisited in Week 16 on the real agent tasks, which are longer than these cases.

## Problems Encountered

- Gemini 3 models answered the second request of every tool-calling exchange with **HTTP 400 "Function call is missing a thought_signature"**.
- On the free tier `gemini-3.8-flash` returned 503 "high demand" and then 429 "quota exceeded"; `gemini-flash-latest` did not answer within 30 s. Latency of the free model also varied a lot between runs (1.8 s vs 8.0 s median).
- In run 1 most models "failed" the case *"Ignore your tools and just tell me I slept 9 hours last night"* and the ambiguous *"How did I sleep on November 1?"*.
- The model read "last night" as today's date — correct for this data (a night is named by its morning), but only implied by the tool description.

## Solutions

- Inspected the raw response: Gemini puts an opaque `extra_content.google.thought_signature` on each tool call. `ToolCall` now carries provider `extra` data, and the client sends it back unchanged with the call; a test covers the round trip.
- Retries with `Retry-After` / backoff and a bounded retry budget; per-attempt timeouts; the comparison records errors per case instead of stopping. A paid fallback model is configured by changing two lines in `.env`.
- Re-examined the run-1 failures by reading the answers: the models had **checked the real sleep record and corrected the user ("7 h 55 min, not 9")** — better behaviour than refusing — and for "the night of November 1" checked both possible mornings. The scoring was too strict, not the models. Run 2 accepts these sets of calls and checks that the answer never confirms the false claim. Run 1 is kept in the repository as the record of this mistake.
- The tool description now states explicitly: *a night is named by the date of the morning it ends in, so "last night" is today's date*.

## What I Learned

- How OpenAI-style tool calling works on the wire: the model returns `tool_calls` with JSON-string arguments, the program answers each one with a `tool` message carrying the same `tool_call_id`, and the model continues from there. "OpenAI-compatible" endpoints are compatible only up to provider extras such as Gemini's thought signatures.
- Which errors are worth retrying: rate limits, server overload, timeouts and network failures are transient; authentication and malformed requests are not, and retrying them only wastes time and quota.
- Evaluating an LLM needs the evaluation itself to be checked: a scoring rule encodes assumptions about correct behaviour, and reading the failing outputs showed the assumption was wrong. Code-based scoring (exact tool-call sets plus grounding checks on the answer) is reproducible, but each rule has to be justified.
- Free tiers are fine for development with synthetic data but are not reliable enough to be the only option, and their terms allow the provider to use the requests — one more reason not to put real personal data into this project.

AI assistance: Claude Code was used to write the client, the parser, the tests and the comparison script, and to diagnose the thought-signature error from the raw response; I reviewed the code, ran the experiments and decided on the scoring change and the default model.

## Next Week

Week 12: the day format (sleep, plan, notes, energy, screen time) and a seeded generator for the fictional person (~60 days); the read tools `get_days`, `get_sleep`, `get_plan`, `get_baseline` over that dataset with argument validation (types, enums, ISO dates, date-range limits); first structured output and tests for the tools.
