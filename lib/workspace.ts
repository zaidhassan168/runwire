export type EnvironmentVariable = {
  key: string;
  value: string;
};

export function isSensitiveVariableKey(key: string): boolean {
  return /token|secret|password|api[_-]?key|authorization/i.test(key);
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
