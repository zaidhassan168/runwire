import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSafePublicUrl, assertSafeRedirect } from './api-safety.ts';

test('allows public HTTP APIs', () => {
  assert.equal(assertSafePublicUrl('https://api.example.com/v1/items').hostname, 'api.example.com');
});

test('blocks local and metadata destinations', () => {
  for (const url of [
    'http://localhost:3000',
    'http://127.0.0.1',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]',
    'https://service.internal',
  ]) {
    assert.throws(() => assertSafePublicUrl(url));
  }
});

test('blocks cross-origin redirects so credentials cannot follow them', () => {
  const current = new URL('https://api.example.com/start');
  assert.equal(assertSafeRedirect(current, new URL('/next', current)).pathname, '/next');
  assert.throws(() => assertSafeRedirect(current, new URL('https://other.example/next')), /Cross-origin/);
});
