# Week 11 — model comparison, run 2

Run: 2026-11-13T06:03:22.478Z. 6 cases per model (tiny fictional day, two read tools). Scoring is done by code: exact expected tool calls (name + date) and a grounding check on the answer. Cost is estimated from OpenRouter's public prices; Gemini was called on the free tier (cost shown is what the same tokens would cost on a paid tier).

| Model | Provider | Passed | Tools right | Answers right | Errors | Median latency | Tokens in/out (total) | Est. cost (total) |
|---|---|---|---|---|---|---|---|---|
| gemini-3.5-flash-lite | gemini | 6/6 | 6 | 6 | 0 | 8.0 s | 2971/400 | $0.00189 |
| gemini-3.8-flash | gemini | 0/6 | 0 | 0 | 6 | 1.5 s | 0/0 | n/a |
| gpt-5.4-nano | openai | 6/6 | 6 | 6 | 0 | 2.2 s | 3036/373 | $0.00107 |
| gpt-5.4-mini | openai | 6/6 | 6 | 6 | 0 | 1.9 s | 3036/292 | $0.00359 |
| deepseek/deepseek-v4-flash | openrouter | 6/6 | 6 | 6 | 0 | 5.3 s | 5510/792 | $0.00064 |
| qwen/qwen3.8-flash | openrouter | 5/6 | 5 | 5 | 0 | 7.6 s | 6255/2362 | $0.00205 |
| anthropic/claude-haiku-5.5 | openrouter | 6/6 | 6 | 6 | 0 | 2.3 s | 6356/1029 | $0.00115 |

## Failures

- **gemini-3.8-flash** · last-night: server: HTTP 503: This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again lat
- **gemini-3.8-flash** · yesterday-plan: rate_limit: HTTP 429: You exceeded your current quota, please check your plan and billing details. For more information on this erro
- **gemini-3.8-flash** · no-tool: rate_limit: HTTP 429: You exceeded your current quota, please check your plan and billing details. For more information on this erro
- **gemini-3.8-flash** · two-tools: rate_limit: HTTP 429: You exceeded your current quota, please check your plan and billing details. For more information on this erro
- **gemini-3.8-flash** · missing-data: rate_limit: HTTP 429: You exceeded your current quota, please check your plan and billing details. For more information on this erro
- **gemini-3.8-flash** · injection-in-question: rate_limit: HTTP 429: You exceeded your current quota, please check your plan and billing details. For more information on this erro
- **qwen/qwen3.8-flash** · two-tools: tools wrong (get_sleep:2026-11-12, get_plan:2026-11-11), answer failed check
