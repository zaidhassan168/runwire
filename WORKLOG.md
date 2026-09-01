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
- Agent-triggered request, flow, and burst execution now runs directly; the obsolete approval gate and its UI have been removed.
- The trace now toggles between safe tool-call history and an animated `run_journey → API requests` flow with methods, endpoints, bindings, response codes, and durations.
- A 1280×720 Chromium runtime proof verified expand/collapse, the API-flow toggle, clickable API nodes, and truthful red failure state for a returned HTTP 400.
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
- The user selected the shared Live Repair Room direction. It now turns a real failed flow into visible request/response evidence, a bounded repair, and a real passing rerun.
- The duplicate host/presence and Agent Trace header rows were collapsed into one 62 px header. Trace history opens as an anchored dropdown instead of consuming permanent workspace height.
- Browser proof passed at `1440 x 1024` and `760 x 900`: failure evidence tabs, bounded repair, `4/4` rerun, responsive header, and clean console.
- WebMCP proof read the repaired journey and failed/passed run history and matched the visible UI state.
- A WebMCP-only replay built Ticket lifecycle from an empty draft, configured its environment, parameters, headers, bodies, and extraction, then ran each request separately. It passed `201 -> 200 -> 200`, reused extracted `ticketId=tkt_53a3600b`, showed 20 trace calls, and used no ordinary UI clicks.
- Live Repair Room design QA passed; evidence is in `design/live-repair-room-failure-single-header.png`, `design/qa-live-repair-room-comparison.png`, and `design-qa.md`.
- The workflow canvas grid was removed at the user's request; the canvas is now a quiet solid surface while connections, bindings, and node states remain visible.
- Colored success, failure, and selection outlines were removed from workflow cards; status remains visible through icons, endpoint results, connector state, and failure evidence.
- The bottom rail keeps the accessible Environment gear action but no longer renders its visible label.
- The audited 12-file release was committed as `b671004` and pushed to public `origin/main`; internal `design/`, `design-qa.md`, and the ignored Devpost draft remain local.

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

- Granular flow composition and step execution are complete and verified locally through Runwire's page-defined WebMCP tools.
- TypeScript, lint, `21/21` tests, production build, and `git diff --check` pass.
- These granular WebMCP changes are local and uncommitted; the previously audited product pass remains on `origin/main`.
- README, demo script, Devpost draft, and local hackathon state now describe the current 22-tool surface and direct trace-visible execution.

## Blockers

- Public YouTube demo recording remains outstanding.

## Next action

Commit the verified tracked changes, publish them to `origin/main`, deploy that exact commit to Sites, and repeat the WebMCP proof on the live URL.
