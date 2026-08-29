export type JourneyStep = {
  id: string;
  label: string;
  method: string;
  url: string;
  expectedStatus: number;
  headers?: [string, string][];
  body?: string;
  extracts?: { key: string; path: string }[];
};

export type JourneyStepResult = {
  id: string;
  status: 'passed' | 'failed';
  actualStatus: number;
  durationMs: number;
  requestUrl?: string;
  requestBody?: string;
  responseBody?: string;
  extracted?: Record<string, string>;
  error?: string;
};

export async function runJourneySequence<T extends { status: number; durationMs: number; body?: string; requestUrl?: string; requestBody?: string }>(
  steps: JourneyStep[],
  execute: (step: JourneyStep, variables: Record<string, string>) => Promise<T>,
  onProgress?: (results: JourneyStepResult[]) => void,
  initialVariables: Record<string, string> = {},
): Promise<JourneyStepResult[]> {
  const results: JourneyStepResult[] = [];
  const variables = { ...initialVariables };
  for (const step of steps) {
    const response = await execute(step, { ...variables });
    const extracted: Record<string, string> = {};
    let extractionError = '';
    for (const extraction of response.status === step.expectedStatus ? step.extracts ?? [] : []) {
      try {
        const value = extractJsonValue(response.body ?? '', extraction.path);
        if (value == null) throw new Error('value was not found');
        const normalized = typeof value === 'string' ? value : JSON.stringify(value);
        variables[extraction.key] = normalized;
        extracted[extraction.key] = normalized;
      } catch {
        extractionError = `Could not extract ${extraction.key} from ${extraction.path}.`;
        break;
      }
    }
    const result: JourneyStepResult = {
      id: step.id,
      status: response.status === step.expectedStatus && !extractionError ? 'passed' : 'failed',
      actualStatus: response.status,
      durationMs: response.durationMs,
      requestUrl: response.requestUrl,
      requestBody: response.requestBody,
      responseBody: response.body,
      extracted,
      error: extractionError || undefined,
    };
    results.push(result);
    onProgress?.([...results]);
    if (result.status === 'failed') break;
  }
  return results;
}

export function extractJsonValue(input: string | unknown, path: string): unknown {
  let value: unknown = typeof input === 'string' ? JSON.parse(input) : input;
  if (!path.startsWith('$')) throw new Error('JSON path must start with $.');
  let cursor = 1;
  while (cursor < path.length) {
    if (path[cursor] === '.') {
      const match = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(path.slice(cursor + 1));
      if (!match) throw new Error('Invalid JSON path property.');
      value = value && typeof value === 'object' ? (value as Record<string, unknown>)[match[0]] : undefined;
      cursor += match[0].length + 1;
      continue;
    }
    if (path[cursor] === '[') {
      const match = /^\[(\d+)\]/.exec(path.slice(cursor));
      if (!match) throw new Error('Invalid JSON path index.');
      value = Array.isArray(value) ? value[Number(match[1])] : undefined;
      cursor += match[0].length;
      continue;
    }
    throw new Error('Unsupported JSON path syntax.');
  }
  return value;
}
