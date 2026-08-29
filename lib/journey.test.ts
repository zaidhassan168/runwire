import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJsonValue, runJourneySequence } from './journey.ts';

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

test('extracts response values and passes them to the next step', async () => {
  const seen: Record<string, string>[] = [];
  const results = await runJourneySequence([
    { id: 'one', label: 'One', method: 'GET', url: '/one', expectedStatus: 200, extracts: [{ key: 'itemId', path: '$.id' }] },
    { id: 'two', label: 'Two', method: 'GET', url: '/two', expectedStatus: 200 },
  ], async (step, variables) => {
    seen.push(variables);
    return { status: 200, durationMs: 10, requestUrl: `/resolved/${step.id}`, requestBody: step.id === 'one' ? '{"name":"Item"}' : '', body: step.id === 'one' ? '{"id":"item_7"}' : '{}' };
  });

  assert.deepEqual(seen, [{}, { itemId: 'item_7' }]);
  assert.deepEqual(results[0].extracted, { itemId: 'item_7' });
  assert.equal(results[0].requestUrl, '/resolved/one');
  assert.equal(results[0].requestBody, '{"name":"Item"}');
});

test('preserves the API response when a failed status prevents extraction', async () => {
  const [result] = await runJourneySequence([
    { id: 'one', label: 'One', method: 'POST', url: '/one', expectedStatus: 201, extracts: [{ key: 'itemId', path: '$.id' }] },
  ], async () => ({ status: 400, durationMs: 10, body: '{"code":"INVALID_REQUEST"}' }));

  assert.equal(result.status, 'failed');
  assert.equal(result.error, undefined);
  assert.equal(result.responseBody, '{"code":"INVALID_REQUEST"}');
});

test('reads object and array JSON paths', () => {
  assert.equal(extractJsonValue('{"items":[{"id":7}]}', '$.items[0].id'), 7);
  assert.equal(extractJsonValue('[{"id":9}]', '$[0].id'), 9);
});
