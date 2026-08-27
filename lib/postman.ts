export type ApiRequestDefinition = {
  id: string;
  name: string;
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
};

export type ApiCollection = {
  id: string;
  name: string;
  requests: ApiRequestDefinition[];
};

type PostmanItem = {
  name?: unknown;
  item?: unknown;
  request?: {
    method?: unknown;
    url?: unknown;
    header?: unknown;
    body?: { raw?: unknown };
  };
};

export function importPostmanCollection(input: unknown, makeId = () => crypto.randomUUID()): ApiCollection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Collection must be a JSON object.');
  const document = input as { info?: { name?: unknown }; item?: unknown };
  const name = typeof document.info?.name === 'string' && document.info.name.trim()
    ? document.info.name.trim()
    : 'Imported collection';
  if (!Array.isArray(document.item)) throw new Error('Postman collection has no items.');

  const requests: ApiRequestDefinition[] = [];
  walkItems(document.item, requests, makeId);
  if (!requests.length) throw new Error('Postman collection contains no HTTP requests.');
  return { id: makeId(), name, requests };
}

function walkItems(items: unknown[], requests: ApiRequestDefinition[], makeId: () => string) {
  for (const value of items) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as PostmanItem;
    if (Array.isArray(item.item)) {
      walkItems(item.item, requests, makeId);
      continue;
    }
    if (!item.request || typeof item.request !== 'object') continue;

    const method = typeof item.request.method === 'string' ? item.request.method.toUpperCase() : 'GET';
    const url = readPostmanUrl(item.request.url);
    const headers: [string, string][] = Array.isArray(item.request.header)
      ? item.request.header.flatMap((header) => {
          if (!header || typeof header !== 'object') return [];
          const record = header as { key?: unknown; value?: unknown; disabled?: unknown };
          return typeof record.key === 'string' && typeof record.value === 'string' && record.disabled !== true
            ? [[record.key, record.value] as [string, string]]
            : [];
        })
      : [];
    const body = typeof item.request.body?.raw === 'string' ? item.request.body.raw : '';

    requests.push({
      id: makeId(),
      name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'Untitled request',
      method,
      url,
      headers,
      body,
    });
  }
}

function readPostmanUrl(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'raw' in value && typeof value.raw === 'string') return value.raw;
  return '';
}

export function exportPostmanCollection(collection: ApiCollection) {
  return {
    info: {
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: collection.requests.map((request) => ({
      name: request.name,
      request: {
        method: request.method,
        header: request.headers.map(([key, value]) => ({ key, value })),
        body: request.body ? { mode: 'raw', raw: request.body } : undefined,
        url: { raw: request.url },
      },
    })),
  };
}
