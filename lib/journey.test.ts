import assert from 'node:assert/strict';
import test from 'node:test';
import { runJourneySequence } from './journey.ts';

test('runs in order and stops at the first failed assertion', async () => {
  const called: string[] = [];
  const results = await runJourneySequence([
    { id: 'one', label: 'One', method: 'GET', url: '/one', expectedStatus: 200 },
    { id: 'two', label: 'Two', method: 'GET', url: '/two', expectedStatus: 201 },
    { id: 'three', label: 'Three', method: 'GET', url: '/three', expectedStatus: 200 },
  ], async (step) => {
    called.push(step.id);
    return { status: step.id === 'two' ? 500 : 200, durationMs: 10 };
  });

  assert.deepEqual(called, ['one', 'two']);
  assert.deepEqual(results.map((result) => result.status), ['passed', 'failed']);
});
