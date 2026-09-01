export type EnvironmentVariable = {
  key: string;
  value: string;
};

export type RequestAuth =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'api-key'; key: string; value: string; location: 'header' | 'query' }
  | { type: 'basic'; username: string; password: string };

export function isSensitiveVariableKey(key: string): boolean {
  return /token|secret|password|api[_-]?key|authorization/i.test(key);
}

export function isSensitiveHeaderKey(key: string): boolean {
  return /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(key) || /token|secret|password|api[_-]?key/i.test(key);
}

export function withoutSensitiveHeaders(headers: [string, string][]): [string, string][] {
  return headers.filter(([key]) => !isSensitiveHeaderKey(key));
}

export function protectSensitiveHeaders(headers: [string, string][]): [string, string][] {
  return headers.map(([key, value]) => [key, isSensitiveHeaderKey(key) ? '[protected]' : value]);
}

export function summarizeAgentToolInput(name: string, input: Record<string, unknown>): string {
  const text = (key: string) => typeof input[key] === 'string' ? input[key] : '';
  const number = (key: string) => typeof input[key] === 'number' ? input[key] : null;
  if (name === 'update_active_request') {
    const method = text('method');
    const rawUrl = text('url');
    let url = '';
    if (rawUrl) {
      try {
        const parsed = new URL(rawUrl, 'https://runwire.local');
        url = `${rawUrl.startsWith('/') ? parsed.pathname : `${parsed.origin}${parsed.pathname}`}${parsed.searchParams.size ? ` · ${parsed.searchParams.size} params` : ''}`;
      } catch { url = 'URL updated'; }
    }
    const body = text('body');
    return [method, url, body ? `body ${body.length} chars` : ''].filter(Boolean).join(' · ') || 'Visible request';
  }
  if (name === 'select_flow') return text('flowId') || 'Flow';
  if (name === 'begin_flow_build') return text('flowId') || 'Flow';
  if (name === 'add_flow_request') return [text('method'), text('stepId')].filter(Boolean).join(' · ') || 'Request';
  if (name === 'set_request_query_parameter') return `${text('stepId') || 'Request'} · ${text('key') || 'parameter'}`;
  if (name === 'set_request_headers') return `${text('stepId') || 'Request'} · headers`;
  if (name === 'set_request_body') return `${text('stepId') || 'Request'} · body ${text('body').length} chars`;
  if (name === 'set_response_extraction') return `${text('stepId') || 'Request'} · ${text('key') || 'value'} from ${text('path') || '$'}`;
  if (name === 'run_flow_step') return text('stepId') || 'Flow step';
  if (name === 'select_journey_step') return text('stepId') || 'Flow step';
  if (name === 'move_flow_node') return [text('stepId'), number('x'), number('y')].filter((value) => value !== '' && value !== null).join(' · ') || 'Flow node';
  if (name === 'run_controlled_burst') return `${number('count') ?? 'default'} requests · ${number('concurrency') ?? 'default'} concurrent`;
  if (name === 'set_environment_variable') return `${text('key') || 'Variable'} · value protected`;
  return 'No arguments';
}

export function agentToolOutputFailed(name: string, output: unknown): boolean {
  if (!output || typeof output !== 'object') return false;
  const value = output as Record<string, unknown>;
  if (name === 'run_journey') return !Array.isArray(value.results) || value.results.some((result) => Boolean(result && typeof result === 'object' && (result as Record<string, unknown>).status === 'failed'));
  if (name === 'run_flow_step') return !value.result || typeof value.result !== 'object' || (value.result as Record<string, unknown>).status === 'failed';
  if (name === 'run_active_request') return !value.response || typeof value.response !== 'object' || Number((value.response as Record<string, unknown>).status) >= 400;
  if (name === 'run_controlled_burst') return !value.result || typeof value.result !== 'object' || Number((value.result as Record<string, unknown>).errors) > 0;
  return false;
}

export function setRawQueryParameter(url: string, key: string, value: string): string {
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const queryIndex = withoutHash.indexOf('?');
  const base = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const entries = (queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '')
    .split('&')
    .filter(Boolean)
    .filter((entry) => decodeURIComponent(entry.split('=')[0]) !== key);
  entries.push(`${encodeURIComponent(key)}=${value}`);
  return `${base}?${entries.join('&')}${hash}`;
}

export function isRequestAuthConfigured(auth: RequestAuth): boolean {
  if (auth.type === 'none') return false;
  if (auth.type === 'bearer') return Boolean(auth.token.trim());
  if (auth.type === 'basic') return Boolean(auth.username);
  return Boolean(auth.key.trim() && auth.value);
}

export function isLocalRequestUrl(url: string): boolean {
  if (!url.startsWith('/')) return false;
  const localOrigin = 'https://journey.local';
  if (new URL(url, localOrigin).origin !== localOrigin) throw new Error('Cross-origin relative URLs are not supported. Use an absolute HTTP URL.');
  return true;
}

export function mergeEnvironmentVariables(defaults: EnvironmentVariable[], saved: EnvironmentVariable[]): EnvironmentVariable[] {
  const savedKeys = new Set(saved.map(({ key }) => key));
  return [...defaults.filter(({ key }) => !savedKeys.has(key)), ...saved];
}

export function resolveTemplate(input: string, variables: EnvironmentVariable[]): string {
  const values = new Map(variables.map(({ key, value }) => [key, value]));
  const unresolved = new Set<string>();
  const resolved = input.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, (_, key: string) => {
    const value = values.get(key);
    if (value == null) {
      unresolved.add(key);
      return `{{${key}}}`;
    }
    return value;
  });
  if (unresolved.size) throw new Error(`Missing environment variable: ${[...unresolved].join(', ')}`);
  return resolved;
}

export function applyRequestAuth(url: string, headers: [string, string][], auth: RequestAuth) {
  if (auth.type === 'none') return { url, headers };
  if (auth.type === 'bearer') {
    if (!auth.token.trim()) throw new Error('Bearer token is required.');
    const nextHeaders = headers.filter(([key]) => key.toLowerCase() !== 'authorization');
    return { url, headers: [...nextHeaders, ['Authorization', `Bearer ${auth.token}`] as [string, string]] };
  }
  if (auth.type === 'basic') {
    if (!auth.username) throw new Error('Basic auth username is required.');
    const nextHeaders = headers.filter(([key]) => key.toLowerCase() !== 'authorization');
    const bytes = new TextEncoder().encode(`${auth.username}:${auth.password}`);
    const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    return { url, headers: [...nextHeaders, ['Authorization', `Basic ${encoded}`] as [string, string]] };
  }
  if (!auth.key.trim() || !auth.value) throw new Error('API key name and value are required.');
  if (auth.location === 'header') return { url, headers: [...headers.filter(([key]) => key.toLowerCase() !== auth.key.toLowerCase()), [auth.key, auth.value] as [string, string]] };
  const nextUrl = new URL(url, 'http://journey.local');
  nextUrl.searchParams.set(auth.key, auth.value);
  return { url: url.startsWith('/') ? `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}` : nextUrl.toString(), headers };
}
