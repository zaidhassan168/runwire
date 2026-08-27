import { getChatGPTUser } from '../../chatgpt-auth';
import { assertSafePublicUrl } from '../../../lib/api-safety';

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const BLOCKED_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
const MAX_REQUEST_BYTES = 256_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 15_000;

type ExecuteInput = {
  method?: unknown;
  url?: unknown;
  headers?: unknown;
  body?: unknown;
};

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: 'Sign in to execute requests.' }, { status: 401 });

  let input: ExecuteInput;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: 'Request payload must be valid JSON.' }, { status: 400 });
  }

  try {
    const method = validateMethod(input.method);
    const url = assertSafePublicUrl(validateString(input.url, 'URL'));
    const headers = validateHeaders(input.headers);
    const body = validateBody(input.body, method);
    const result = await executeWithSafeRedirects(url, { method, headers, body });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The request could not be executed.';
    const timeout = error instanceof Error && error.name === 'AbortError';
    return Response.json({ error: timeout ? `Request timed out after ${TIMEOUT_MS / 1000} seconds.` : message }, { status: timeout ? 504 : 400 });
  }
}

function validateMethod(value: unknown): string {
  const method = typeof value === 'string' ? value.toUpperCase() : '';
  if (!ALLOWED_METHODS.has(method)) throw new Error('Unsupported HTTP method.');
  return method;
}

function validateString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function validateHeaders(value: unknown): Headers {
  if (value == null) return new Headers();
  if (!Array.isArray(value) || value.length > 50) throw new Error('Headers must be a list of at most 50 entries.');

  const headers = new Headers();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Each header needs a name and value.');
    const name = validateString(entry[0], 'Header name');
    const headerValue = validateString(entry[1], 'Header value');
    const normalizedName = name.toLowerCase();
    if (BLOCKED_HEADERS.has(normalizedName) || normalizedName.startsWith('cf-') || normalizedName.startsWith('x-forwarded-')) {
      throw new Error(`The ${name} header cannot be forwarded.`);
    }
    headers.append(name, headerValue);
  }
  return headers;
}

function validateBody(value: unknown, method: string): string | undefined {
  if (value == null || value === '') return undefined;
  if (method === 'GET' || method === 'HEAD') throw new Error(`${method} requests cannot include a body.`);
  if (typeof value !== 'string') throw new Error('Request body must be text.');
  if (new TextEncoder().encode(value).byteLength > MAX_REQUEST_BYTES) throw new Error('Request body exceeds 256 KB.');
  return value;
}

async function executeWithSafeRedirects(initialUrl: URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let url = initialUrl;
  const startedAt = performance.now();

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new Error('The API returned a redirect without a location.');
        if (redirectCount === MAX_REDIRECTS) throw new Error(`The API redirected more than ${MAX_REDIRECTS} times.`);
        url = assertSafePublicUrl(new URL(location, url).toString());
        continue;
      }

      const body = await readLimitedBody(response);
      return {
        requestUrl: url.toString(),
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        body: body.text,
        durationMs: Math.round(performance.now() - startedAt),
        sizeBytes: body.sizeBytes,
        truncated: body.truncated,
      };
    }
  } finally {
    clearTimeout(timeout);
  }

  throw new Error('The request could not be completed.');
}

async function readLimitedBody(response: Response) {
  if (!response.body) return { text: '', sizeBytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let sizeBytes = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (sizeBytes + value.byteLength > MAX_RESPONSE_BYTES) {
      const remaining = MAX_RESPONSE_BYTES - sizeBytes;
      if (remaining > 0) chunks.push(value.slice(0, remaining));
      sizeBytes += remaining;
      truncated = true;
      await reader.cancel();
      break;
    }
    chunks.push(value);
    sizeBytes += value.byteLength;
  }

  const bytes = new Uint8Array(sizeBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes), sizeBytes, truncated };
}
