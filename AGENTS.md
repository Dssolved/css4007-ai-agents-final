# Notes for AI coding assistants

This is a public course fork (CSS 4007 final project, A level): an autonomous companion agent over a person's day. The plan is in `reports/proposal.md`.

- **No personal data, ever.** Development, tests and the demo use only the fictional person (synthetic, seeded dataset). Do not copy code, documents, names, places, app names or real notes from any other project into this repository. The history of a public fork cannot be cleaned.
- A pre-commit privacy check (`scripts/privacy-check.mjs`, enabled with `git config core.hooksPath .githooks`) blocks words from a private denylist kept outside the repository. Do not bypass it with `--no-verify`.
- Secrets only in `.env` (git-ignored); `.env.example` holds the variable names.
- Stack: TypeScript on Node.js 22.18+ with native type stripping (erasable syntax only: no enums, no namespaces, no parameter properties); no runtime dependencies unless justified.
- Commits: meaningful, 2–4 per week, matching `reports/week-NN.md`. Never backdate.
- AI assistance is disclosed in the weekly reports and the final report.
