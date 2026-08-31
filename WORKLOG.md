# Runwire worklog

## Goal

Make Runwire a production-grade, agent-native API workspace where a person or WebMCP agent can compose, run, inspect, chain, repair, and verify API workflows in one shared visual surface; prove that experience in a judge-ready demo while keeping the Devpost packet ready but not submitted.

## Current state

- Live public Site: `https://journey-api-workspace.zaidulhassan.chatgpt.site/`
- Public repo: `https://github.com/zaidhassan168/runwire`
- Verified live WebMCP failure → bounded repair → passing rerun.
- Local Devpost draft and 2:35 recording guide prepared; video not recorded yet.
- User wants continued product refinement before recording and final submission.
- Local polish now supports unauthenticated guest startup and public first-party demo execution.
- Cloud workspace saving and arbitrary external API execution remain sign-in protected.
- Judge-scale typography and the local failure → repair → `4/4` rerun were verified at 1280×720.
- `21/21` tests, lint, build, diff check, and unauthenticated HTTP boundary checks pass.
- A local WebMCP Agent Trace now exposes safe tool intent, running/passed/failed state, duration, and recent history across every screen.
- The collapsed and expanded trace layouts were verified at 1280×720; trace redaction is covered by the 18th test.
- Agent-triggered request, flow, and burst execution now pauses in the trace for explicit human approval; read-only and bounded repair tools remain immediate.
- The trace now toggles between safe tool-call history and an animated `run_journey → API requests` flow with methods, endpoints, bindings, response codes, and durations.
- A 1280×720 Chromium runtime proof verified expand/collapse, the API-flow toggle, clickable API nodes, approval, denial, approved execution, and truthful red failure state for a returned HTTP 400.
- The Flow screen now uses one command bar and one dominant canvas, with clearer execution state, readable binding capsules, compact nodes, and an actionable failure footer that opens the exact failed-node repair.
- The Request screen now uses a full-height editor/response split, and short Agent Trace histories stay compact instead of consuming the workspace.
- The orphaned collapsed-navigator button was removed; Requests, Flows, and Runs now open or collapse their navigator directly from the left rail.
- The redundant blue active-rail edge stripe was removed; selection remains visible through the rail item's soft background and blue icon/text.
- A fresh 1280×720 browser proof verified `get_flow_map` through WebMCP, visible tool-call evidence, auto-layout, failure selection, and the inspector repair path.
- `21/21` tests, lint, production build, and `git diff --check` pass after the final UI polish.
- The Requests workspace now matches the supplied Runwire reference at `1007 × 1086`: persistent Collections, centered host/presence header, request composer, full-height Tests/Response split, designed empty response state, response metadata, and collapsed WebMCP evidence row.
- Design QA passed after three source-to-implementation comparison iterations; final evidence is in `design/qa-runwire-comparison-final.png` and `design-qa.md`.
- Browser interaction proof passed: visible Send returned `200`, response tabs and inspector worked, collection selection restored correctly, and WebMCP `get_last_response` read the same visible result. A fresh tab reported no console errors.
- Responsive checks passed at `1280 × 720` and `760 × 900`; final lint, `21/21` tests, TypeScript, build, and diff checks pass.
- The README now leads with current-build Canvas and Requests screenshots; five portable `1280 × 720` judge screenshots live under `docs/screenshots/` instead of private visualization paths.
- `DEMO.md` and the ignored Devpost draft now use the real Canvas/Evidence labels. The spoken script is 206 words (about 1:47 at 115 wpm) inside the 2:35 shot plan.
- Submission-readiness verification confirms every screenshot link exists, tracked docs contain no private absolute paths, the live Site and public GitHub repository return HTTP 200, and lint, typecheck, `21/21` tests, build, and diff checks pass.
- The user selected the shared Live Repair Room direction. It now turns a real failed flow into visible request/response evidence, a bounded diff, human approval, and a real passing rerun.
- The duplicate host/presence and Agent Trace header rows were collapsed into one 62 px header. Trace history and approvals now open as an anchored dropdown instead of consuming permanent workspace height.
- Browser proof passed at `1440 x 1024` and `760 x 900`: failure evidence tabs, repair approval, `4/4` rerun, responsive header, and clean console.
- WebMCP proof read the repaired journey and failed/passed run history and matched the visible UI state.
- Live Repair Room design QA passed; evidence is in `design/live-repair-room-failure-single-header.png`, `design/qa-live-repair-room-comparison.png`, and `design-qa.md`.
- The workflow canvas grid was removed at the user's request; the canvas is now a quiet solid surface while connections, bindings, and node states remain visible.
- Colored success, failure, and selection outlines were removed from workflow cards; status remains visible through icons, endpoint results, connector state, and failure evidence.
- The bottom rail keeps the accessible Environment gear action but no longer renders its visible label.
- Release audit confirms a 12-file public manifest that excludes `design/`, `design-qa.md`, and the ignored Devpost draft. The manifest has no secret-shaped values or private machine paths; GitHub auth is active, the repository is public, and local `main` is one commit ahead of `origin/main` before the uncommitted pass.

## Decisions

- Preserve the clean unrepaired Checkout demo state for recording.
- Use the Live Repair Room as the hero demo direction.
- Keep one persistent top header; Agent Trace details are transient dropdown content.
- Keep the workflow canvas free of decorative grid lines.
- Keep workflow card borders neutral; do not duplicate status with heavy colored outlines.
- Keep the final video screen-and-voice only; no face camera required.
- Keep Devpost draft local and do not submit until the user explicitly requests it.
- Preserve untracked `design/` and `design-qa.md` unless a change is intentionally adopted.

## Current work

- Live Repair Room and the single-header refinement are complete and verified locally.
- Lint, TypeScript, `21/21` tests, production build, `git diff --check`, desktop/compact browser checks, and design QA pass.
- The new product pass is intentionally uncommitted. Push and deployment remain unauthorized.

## Blockers

- Committing the audited public manifest, pushing `main`, and deploying to Sites require explicit approval.

## Next action

Keep the local failure state open for user inspection. On explicit authorization, commit the release candidate; only then push and deploy to Sites, repeat the live WebMCP failure → repair → passing rerun proof, and refresh demo evidence.
