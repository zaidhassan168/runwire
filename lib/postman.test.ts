import assert from 'node:assert/strict';
import test from 'node:test';
import { exportPostmanCollection, importPostmanCollection } from './postman.ts';

test('imports nested Postman requests and exports v2.1', () => {
  let id = 0;
  const collection = importPostmanCollection({
    info: { name: 'Commerce' },
    item: [{ name: 'Orders', item: [{ name: 'Get order', request: { method: 'GET', url: { raw: '{{baseUrl}}/orders/1' } } }] }],
  }, () => `id-${++id}`);

  assert.equal(collection.name, 'Commerce');
  assert.equal(collection.requests[0].url, '{{baseUrl}}/orders/1');
  assert.equal(exportPostmanCollection(collection).info.name, 'Commerce');
});
