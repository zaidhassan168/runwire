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
