# Semester Week 12 Progress Report

## Completed Work

- **Day format** (`src/data/types.ts`): one record per logical day (the day starts at 04:00; a night is named by its morning) — sleep (bed, asleep, wake, rise, how it felt), mood (valence, arousal, tension, words), energy ratings, meals, morning and evening routines, screen time by device and category with minutes after 22:00, steps, workout, free-text notes. Tasks with size, sphere, day or inbox / someday, number of moves, the day first planned for, repetition, and optional deadline and fixed time. A **profile** in the person's own words: base habits with their cost and reason, intentions, planning rules.
- **Fictional person** (`src/data/generate.ts`): a deterministic, seeded generator of 60 days for "Mira", a designer who takes an evening course. Planted patterns, written to a separate truth file the agent's tools never read: late screens → later sleep and lower energy the next day; late dinners → longer to fall asleep and worse sleep; workouts → deeper sleep; overloaded Thursdays; a heavy two-week period (work after 22:00, fewer steps, more moved tasks, stress in notes) during which base habits slip; data gaps; one note with an injected instruction. The next week holds an exam, a project hand-in, an appointment and an inbox of ten tasks — the planning scenario for the following weeks.
- **Dataset validation** (`src/data/load.ts`) with the path to every problem.
- **Argument validation** (`src/tools/schema.ts`) from the same JSON Schema the model sees, and a **tool registry** (`src/tools/registry.ts`): each tool has a schema, a permission (`read` / `write`), cross-argument checks and an implementation; `callTool` is the only path from a model call to code.
- **Read tools** (`src/tools/read.ts`): `get_rhythm`, `get_days`, `get_sleep`, `get_plan` (with inbox), `get_baseline` (the person's own median and usual range, counted only over days that have the data).
- **Rhythm portrait** (`src/analytics/rhythm.ts`, tool `get_rhythm`): usual times, energy through the day with peak and dip, how much a normal day holds, the last two weeks against the usual, sleep debt, slipping base habits, where moved tasks come from, the load of the next seven days.
- **Demo** (`npm run ask -- "question"`): a real model answers questions about Mira through these tools, with her profile and the companion voice in the system prompt.
- 20 new tests (40 in total, all offline), including tests that every planted pattern is actually present in the data and visible in the portrait.

## Important Commits

- Commit hash: 695ed2a
- Description: day format, seeded fictional-person generator with planted patterns, dataset validation and tests
- Link: https://github.com/Dssolved/css4007-ai-agents-final/commit/695ed2a

- Commit hash: 8f6ea0b
- Description: read tools with validated arguments, tool registry, first answers about the fictional person
- Link: https://github.com/Dssolved/css4007-ai-agents-final/commit/8f6ea0b

- Commit hash: 8b0e07d
- Description: rhythm portrait computed by code and exposed as `get_rhythm`; tests that it shows the planted patterns
- Link: https://github.com/Dssolved/css4007-ai-agents-final/commit/8b0e07d

## Current Functionality

The application can answer questions about the fictional person's days with a real model that chooses among five read tools. Example (`npm run ask -- "Why have I been sleeping badly lately?"`, gemini-3.5-flash-lite): the model called `get_rhythm`, `get_sleep`, `get_days` and `get_baseline` twice, and answered that Mira falls asleep near 1 a.m. instead of before midnight, sleeps under seven hours, that evenings stretched later with screens and workouts dropped to two in two weeks, and suggested one concrete step tied to her own intention, ending with a question. Invalid arguments (impossible dates, reversed or too long ranges, unknown arguments, unknown tools) are rejected before any tool runs, and the error is returned to the model so it can correct itself.

## Problems Encountered

- A test for "Thursdays are overloaded" failed: moved tasks only showed where they **landed** (Friday), not where they **left** from, so the pattern was invisible in the data — and would have been invisible to the agent.
- The first version of the portrait compared the last 7 days with the 28 days before them; that "usual" window already contained the first heavy week, and the drift of the evening stretch disappeared (0.57 vs 0.54).
- In the demo the model computed its baseline over 30 days that included the heavy period itself, which blurred the comparison. In another answer it missed late dinners, one of the planted causes of bad sleep.

## Solutions

- Added an optional `firstDate` (the day a task was first planned for) to the format; the generator records it and the portrait reports where moved tasks mostly come from (Thursday). Lesson for the real app: a move counter alone hides where plans break.
- "Lately" is now the last 14 days, compared with the 28 days before them; sleep debt stays over the last 7 nights. Tests assert that exactly the two slipping habits are detected.
- The comparison is now precomputed by code in `get_rhythm`, which the tool description tells the model to call first. Choosing comparison windows inside the agent, and checking that answers name the planted causes, are planned for the agent workflow (Week 14) and the evaluation (Week 16).

## What I Learned

- Synthetic data for evaluating an agent needs a known ground truth: planting patterns on purpose, keeping the truth hidden from the agent, and testing that the data really contains them turns "the answer sounds plausible" into something checkable.
- What the data format does not record, an agent cannot discover (the move counter vs the day a task was first planned). Designing the format is part of designing the agent.
- Baselines depend on the window: comparing with a period that already contains the change hides the change. Personal baselines should also be computed only over days that have the data.
- Splitting the work between code and model: deterministic aggregation (medians, debts, loads) in code, interpretation and wording in the model — cheaper and more reliable than asking the model to do arithmetic over raw records.

AI assistance: Claude Code wrote the generator, the tools, the portrait and the tests from a design we discussed (persona, planted patterns, the format compatible with a real routine app); I chose the scenarios and the patterns, reviewed the code and ran the demos.

## Next Week

Week 13: write tools with a permission policy — `propose_task`, `move_task`, `schedule_reminder` — with levels of autonomy (small reversible moves within the week without asking but with undo; big tasks, deadlines, appointments and weekends only with approval; no deletion at all); a plan checker in code (deadlines, fixed times, meal times, the person's rules, daily load against capacity); `search_notes` with notes treated as untrusted content.
