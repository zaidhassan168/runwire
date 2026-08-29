import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRequestAuth, isLocalRequestUrl, isRequestAuthConfigured, mergeEnvironmentVariables, protectSensitiveHeaders, resolveTemplate, withoutSensitiveHeaders, isSensitiveVariableKey } from './workspace.ts';

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

test('applies request auth without retaining an older authorization header', () => {
  assert.deepEqual(
    applyRequestAuth('/orders', [['Authorization', 'manual']], { type: 'none' }).headers,
    [['Authorization', 'manual']],
  );
  assert.deepEqual(
    applyRequestAuth('https://api.example.com/orders', [['Authorization', 'old']], { type: 'bearer', token: 'new-token' }),
    { url: 'https://api.example.com/orders', headers: [['Authorization', 'Bearer new-token']] },
  );
  assert.equal(
    applyRequestAuth('/orders?draft=1', [], { type: 'api-key', key: 'client_id', value: 'demo', location: 'query' }).url,
    '/orders?draft=1&client_id=demo',
  );
  assert.deepEqual(
    applyRequestAuth('/orders', [], { type: 'basic', username: 'user', password: 'pass' }).headers,
    [['Authorization', 'Basic dXNlcjpwYXNz']],
  );
});

test('protects credentials at save and agent boundaries', () => {
  const headers: [string, string][] = [['Accept', 'application/json'], ['Authorization', 'Bearer secret'], ['X-API-Key', 'secret']];
  assert.deepEqual(withoutSensitiveHeaders(headers), [['Accept', 'application/json']]);
  assert.deepEqual(protectSensitiveHeaders(headers), [['Accept', 'application/json'], ['Authorization', '[protected]'], ['X-API-Key', '[protected]']]);
  assert.equal(isRequestAuthConfigured({ type: 'bearer', token: '' }), false);
  assert.equal(isRequestAuthConfigured({ type: 'basic', username: 'user', password: '' }), true);
});

test('only classifies single-slash paths as local requests', () => {
  assert.equal(isLocalRequestUrl('/api/orders'), true);
  assert.equal(isLocalRequestUrl('https://api.example.com/orders'), false);
  assert.throws(() => isLocalRequestUrl('//api.example.com/orders'), /Cross-origin relative/);
  assert.throws(() => isLocalRequestUrl('/\\api.example.com/orders'), /Cross-origin relative/);
});
