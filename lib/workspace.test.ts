import assert from 'node:assert/strict';
import test from 'node:test';
import { isSensitiveVariableKey, mergeEnvironmentVariables, resolveTemplate } from './workspace.ts';

test('resolves environment variables', () => {
  assert.equal(
    resolveTemplate('{{baseUrl}}/orders/{{orderId}}', [
      { key: 'baseUrl', value: 'https://api.example.com' },
      { key: 'orderId', value: 'ord_123' },
    ]),
    'https://api.example.com/orders/ord_123',
  );
});

test('reports unresolved variables', () => {
  assert.throws(() => resolveTemplate('{{baseUrl}}/orders/{{orderId}}', []), /baseUrl, orderId/);
});

test('identifies secret-like environment keys', () => {
  assert.equal(isSensitiveVariableKey('STRIPE_API_KEY'), true);
  assert.equal(isSensitiveVariableKey('baseUrl'), false);
});

test('keeps required defaults while saved environment values win', () => {
  assert.deepEqual(
    mergeEnvironmentVariables(
      [{ key: 'baseUrl', value: 'https://default.example' }, { key: 'region', value: 'us' }],
      [{ key: 'region', value: 'eu' }],
    ),
    [{ key: 'baseUrl', value: 'https://default.example' }, { key: 'region', value: 'eu' }],
  );
});
