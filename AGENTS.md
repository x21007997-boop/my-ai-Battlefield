# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product direction

- The selected visual source is `/Users/mac-wu/.codex/generated_images/019fcb59-a523-7251-8523-4c75905b7834/exec-fd316ed5-d4b2-4fa0-b1a0-dbc59bda0ec2.png`.
- Preserve the warm late-Ming archive aesthetic: walnut frame, rice paper, muted cinnabar, jade green and restrained gold.
- The primary screen must keep the historical map as the dominant surface, with realm indicators on the left and a two-part right column: selected memorial above, adviser council below.
- Core interactions are reading memorials, comparing advisers, entering a free-form decision, analysing impact, confirming it, and advancing one monthly turn.
- Do not turn the product into a generic admin dashboard or a precise modern military planning interface.
- Historical content belongs in versioned packages under `scenarios/`; keep the generic rule engine free of scenario-specific prose and run `npm run validate:scenario` after changing a scenario package.
