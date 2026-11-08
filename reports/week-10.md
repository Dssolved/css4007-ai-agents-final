# Semester Week 10 Progress Report

## Completed Work

- Forked the instructor repository and chose the project: **Kairos Agent**, an autonomous companion agent that reasons over a person's day (sleep, plan, notes, energy, screen time) and proposes plan changes that are applied only after human approval.
- Selected difficulty **A** and wrote `reports/proposal.md`: problem, users, functions with preliminary signatures, nine tools with a permission table (read / write-with-approval / control), model selection, architecture (core loop + host interface), five example requests including missing-information and prompt-injection cases, evaluation plan and milestones for Weeks 10–17.
- Decided the data policy: development, tests and the demo use only a **fictional person** (synthetic seeded dataset); no real personal data in the repository.
- Repository setup for that policy: a **pre-commit privacy check** (`scripts/privacy-check.mjs` + `.githooks/pre-commit`) that blocks commits containing words from a private denylist stored outside the repository, with tests; commits use a GitHub no-reply e-mail.
- `.env.example` for an OpenAI-compatible provider (OpenRouter by default); `AGENTS.md` with rules for AI coding assistants (no personal data, stack, commit discipline).

## Important Commits

- Commit hash: 122df57
- Description: Week 10 — project proposal (A level), privacy pre-commit check with tests, OpenRouter env example, assistant notes
- Link: https://github.com/Dssolved/css4007-ai-agents-final/commit/122df57

## Current Functionality

No agent code yet (planned for Week 11). The repository validates the proposal (`npm run proposal` passes), runs the starter and privacy-check tests (`npm test`: 12 passing), and refuses commits that contain denylisted private words.

## Problems Encountered

- The project is meant to grow into a component of a personal routine app, but this fork is public: any personal detail committed once stays in the history.
- The privacy check needs a list of private words, but storing that list in the repository would itself publish them.
- Choosing a language: the course tooling is Node.js without dependencies, while the future host app is written in TypeScript.

## Solutions

- Split the design into a data-independent **core** (loop, tools contract, guardrails) and a **host** that supplies tool implementations; this repository contains only the core and a synthetic host.
- The denylist lives in the home directory (`~/.css4007-denylist.txt`); the check prints only the index of a matched word and the file name, not the word.
- TypeScript on Node.js 22.18+ with native type stripping: typed code without a build step or dependencies, runnable by the course CI (Node 22).

## What I Learned

- What distinguishes an A-level agent from a tool-calling chatbot: explicit state, planning and replanning, bounded execution and enforced (not prompted) permissions.
- Prompt injection is a data-flow problem: free-text notes returned by a tool must be treated as untrusted content, and the defence has to be enforced in code (permission table, approval for writes) rather than only in the system prompt.
- Git hooks are not versioned by default; `core.hooksPath` points Git to a versioned hooks folder.

AI assistance: Claude Code was used to discuss the design, draft the proposal and write the privacy-check script and its tests; I reviewed and adjusted the content.

## Next Week

Week 11: provider adapter for an OpenAI-compatible API (OpenRouter), first working request with tool calling, response parsing and error handling (timeouts, 429/5xx, malformed tool calls), and a small comparison of 2–3 models on cost and correctness.
