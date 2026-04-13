# Collaboration Preferences

How the user likes to work with Claude on this project.

## Project naming

- Call the project **"Fractals"** or **"FractalTV"**. Never "FractalTV-M".

## Collaboration style

- **Not a JS expert.** Don't assume deep JS/React knowledge. Write clear code and explain non-obvious patterns.
- **Opus for planning / brainstorming, Sonnet for coding execution.** Model choice is deliberate.
- **Explain the why, not just the what.** User wants to understand trade-offs, not just be told what to do. Present options with pros/cons, then recommend.
- **Willing to start fresh.** Values creativity over preserving existing code: *"if we don't like it we will revert"*.
- **Terse responses.** No "here's what I did" summaries at the end — the user can read the diff. Don't pad discussions with diagnosis sections; the open questions are what matters.

## Response format for options

When presenting choices, follow this shape:

1. One-line framing of the situation.
2. A pros/cons list per option.
3. A final recommendation.

Don't stretch it into sections with headers. Keep it tight.

## Internal vs user-facing tasks

- Use `TaskCreate` internally to track progress when useful.
- **Never surface task status to the user.** No "here's my task list" messaging — they don't want it.

## Git / push behavior

- Only push when explicitly asked.
- Only commit when explicitly asked.
- Don't force-push to `master` ever.
- Don't destructive-reset without asking.

## Sanity before "done"

Never declare an implementation complete without a quick sanity sweep — grep for removed/added symbols, read the final state of heavily-edited files. User has seen too many "done" claims that crashed on load.

## Scope discipline

- A bug fix doesn't need surrounding cleanup.
- A one-shot operation doesn't need a helper.
- Don't design for hypothetical future requirements.
- Don't refactor for elegance unless asked.

## Communicating with the user

- Default to direct, short text.
- When updating during work: one sentence per update, state results and decisions, don't narrate internal deliberation.
- End-of-turn summary: one or two sentences max. What changed + what's next.
- No emojis unless explicitly requested.
