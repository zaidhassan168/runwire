# Runwire judge demo

Target length: **2 minutes 35 seconds**

## Before recording

- Open the deployed Site in ChatGPT's in-app browser.
- Open **Flows → Checkout recovery → Map**.
- Keep the browser wide enough to show the four workflow nodes.
- Start from an unrepaired workspace so Create order has no idempotency header.

## Script and shot list

### 0:00–0:15 — Show the product working

> This is Runwire: API workflows for people and agents. These four requests are executable, and response values are wired into the requests that follow.

Show the Checkout recovery map and point to the `customerId` and `orderId` bindings.

### 0:15–0:35 — Establish why WebMCP matters

> The agent is not clicking through a reconstructed interface. Runwire exposes 15 page-defined WebMCP tools that operate on the same flow and run evidence I can see.

Ask the agent:

> Inspect the visible Checkout recovery flow, then run it through WebMCP.

### 0:35–1:05 — Let the real failure happen

Keep Runwire visible while the agent calls `get_journey` and `run_journey`.

> Customer creation passes and its ID is injected into Create order. That request fails with a real 400: `MISSING_IDEMPOTENCY_KEY`. Runwire stops immediately instead of hiding or hallucinating past the error.

Switch to **List** briefly and expand Create order to show the request and response evidence.

### 1:05–1:35 — Repair through WebMCP

Ask the agent:

> Diagnose the failed step, apply the available safe repair through WebMCP, and rerun the flow.

> The repair is bounded: Runwire adds the generated `Idempotency-Key` header to the failing request. The same visible workflow is updated—there is no second agent-only copy.

### 1:35–2:05 — Prove chaining and completion

Show the final `4/4` result:

> The rerun creates the customer, creates the order, injects both extracted IDs into Get order, and cleans up with Delete order: `201, 201, 200, 204`.

Open **Runs** and show the failed run beside the repaired passing run.

### 2:05–2:35 — Close on differentiation

> Traditional API clients make humans author and debug every step. Generic browser agents guess at controls. Runwire gives both of them one inspectable execution surface: visible requests, semantic tools, safe repair, and durable regression evidence. Wire it. Run it. Repair it.

End on the flow map with the Runwire name visible.

## Recording guardrails

- Do not show setup, localhost, source code, or import screens.
- Do not narrate every tool call; narrate the state transition.
- Keep the failure response and the final `4/4` result readable.
- If a request is slow, cut the wait rather than speeding up the whole recording.
- Record one clean take under three minutes before adding captions or music.
