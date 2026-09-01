# Runwire judge demo

Target length: **2 minutes 35 seconds**

## First-time recording recipe (macOS)

1. Close notifications and unrelated tabs, then open only the deployed Runwire Site and the ChatGPT conversation used for WebMCP.
2. Put the browser at 100% zoom and make the Runwire text, error response, and final `4/4` result readable.
3. Press **Shift–Command–5**, choose **Record Entire Screen**, then select **Options → Microphone** and choose the microphone you will use.
4. Record a 20-second sound check. Play it back and confirm your voice is clear before recording the real take.
5. Start recording, wait two seconds, and follow the timed script below. Speak slowly; silence while the agent works is fine.
6. Stop from the menu-bar recording icon. Open the video in QuickTime and use **Edit → Trim** only to remove silence at the beginning or end.
7. Upload the final file to YouTube as **Public**, add the title `Runwire — WebMCP Challenge Demo`, and verify the link in a signed-out/private window.

Do one silent rehearsal before the recorded take. Skip music, transitions, face camera, and animated titles—the product interaction is the proof.

## Before recording

- Open the deployed Site in ChatGPT's in-app browser.
- Open **Flows → Checkout recovery → Canvas**.
- Keep the browser wide enough to show the four workflow nodes.
- Start from an unrepaired workspace so Create order has no idempotency header.

## Script and shot list

### 0:00–0:15 — Show the product working

> This is Runwire: API workflows for people and agents. These four requests are executable, and response values are wired into the requests that follow.

Show the Checkout recovery canvas and point to the `customerId` and `orderId` bindings.

### 0:15–0:35 — Establish why WebMCP matters

> The agent is not clicking through a reconstructed interface. Runwire exposes 22 page-defined WebMCP tools that operate on the same flow and run evidence I can see.

Ask the agent:

> Inspect the visible Checkout recovery flow, then run it through WebMCP.

### 0:35–1:05 — Let the real failure happen

Keep Runwire visible. The Agent Trace opens automatically as the agent calls `get_journey`, then shows `run_journey` invoking each real API with response status, duration, and extracted-value edges. No browser-control clicks are used for the agent actions.

> Customer creation passes and its ID is injected into Create order. That request fails with a real 400: `MISSING_IDEMPOTENCY_KEY`. Runwire stops immediately instead of hiding or hallucinating past the error.

Switch to **Evidence** briefly and expand Create order to show the request and response evidence.

### 1:05–1:35 — Repair through WebMCP

Ask the agent:

> Diagnose the failed step, apply the available safe repair through WebMCP, then rerun Create customer, Create order, Get order, and Delete order one request at a time.

The bounded repair applies immediately because it does not send network traffic. Leave the Agent Trace open while each `run_flow_step` call appears separately.

> The repair is bounded: Runwire adds the generated `Idempotency-Key` header to the failing request. The same visible workflow is updated—there is no second agent-only copy.

Point once to `apply_idempotency_repair` in the Agent Trace, then return attention to the changed workflow.

### 1:35–2:05 — Prove chaining and completion

Show the final `4/4` result:

> The rerun creates the customer, creates the order, injects both extracted IDs into Get order, and cleans up with Delete order: `201, 201, 200, 204`.

Open **Runs**, expand the history navigator, select the failed run, then select the repaired passing run.

### 2:05–2:35 — Close on differentiation

> Traditional API clients make humans author and debug every step. Generic browser agents guess at controls. Runwire gives both of them one inspectable execution surface: visible requests, semantic tools, safe repair, and durable regression evidence. Wire it. Run it. Repair it.

End on the flow canvas with the Runwire name visible.

## Recording guardrails

- Do not show setup, localhost, source code, or import screens.
- Keep the Agent Trace visible, but narrate state transitions instead of reading every tool name aloud.
- Keep the first `run_journey`, the repair, and the four granular `run_flow_step` calls visible in Agent Trace.
- Keep the failure response and the final `4/4` result readable.
- If a request is slow, cut the wait rather than speeding up the whole recording.
- Record one clean take under three minutes before adding captions or music.

## Upload checklist

- Duration is below three minutes.
- Spoken audio is present and understandable.
- The public Site URL is visible, never localhost.
- The real `MISSING_IDEMPOTENCY_KEY` failure is readable.
- The WebMCP repair and the passing `201, 201, 200, 204` rerun are visible.
- No secrets, personal notifications, third-party trademarks, or copyrighted music appear.
- The YouTube visibility is **Public**, and the link works while signed out.
