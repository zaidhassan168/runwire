import assert from 'node:assert/strict';
import test from 'node:test';
import { autoLayoutJourney, buildJourneyEdges, moveJourneyNode, normalizeJourneyPositions } from './flow.ts';
import type { JourneyStep } from './journey.ts';

const steps: JourneyStep[] = [
  { id: 'customer', label: 'Create customer', method: 'POST', url: '/customers', expectedStatus: 201, extracts: [{ key: 'customerId', path: '$.id' }] },
  { id: 'order', label: 'Create order', method: 'POST', url: '/orders', expectedStatus: 201 },
  { id: 'read', label: 'Read order', method: 'GET', url: '/orders/{{orderId}}', expectedStatus: 200 },
];

test('builds an ordered executable flow with extraction labels', () => {
  const positions = autoLayoutJourney(steps);
  const edges = buildJourneyEdges(steps);
  assert.equal(new Set(positions.map(({ x }) => x)).size, steps.length);
  assert.deepEqual(edges.map(({ from, to }) => [from, to]), [['customer', 'order'], ['order', 'read']]);
  assert.equal(edges[0].label, 'customerId');
});

test('normalizes saved positions and clamps agent movement', () => {
  const positions = normalizeJourneyPositions(steps, [{ id: 'customer', x: -10, y: 9999 }]);
  assert.deepEqual(positions[0], { id: 'customer', x: 24, y: 720 });
  assert.deepEqual(moveJourneyNode(positions, 'order', 410.4, 212.7)[1], { id: 'order', x: 410, y: 213 });
});
