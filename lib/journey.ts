export type JourneyStep = {
  id: string;
  label: string;
  method: string;
  url: string;
  expectedStatus: number;
};

export type JourneyStepResult = {
  id: string;
  status: 'passed' | 'failed';
  actualStatus: number;
  durationMs: number;
};

export async function runJourneySequence<T extends { status: number; durationMs: number }>(
  steps: JourneyStep[],
  execute: (step: JourneyStep) => Promise<T>,
  onProgress?: (results: JourneyStepResult[]) => void,
): Promise<JourneyStepResult[]> {
  const results: JourneyStepResult[] = [];
  for (const step of steps) {
    const response = await execute(step);
    const result: JourneyStepResult = {
      id: step.id,
      status: response.status === step.expectedStatus ? 'passed' : 'failed',
      actualStatus: response.status,
      durationMs: response.durationMs,
    };
    results.push(result);
    onProgress?.([...results]);
    if (result.status === 'failed') break;
  }
  return results;
}
