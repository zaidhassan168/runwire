import type { JourneyStep } from './journey';

export type JourneyNodePosition = { id: string; x: number; y: number };
export type JourneyFlowEdge = { id: string; from: string; to: string; label: string };

export const FLOW_NODE_WIDTH = 176;
export const FLOW_NODE_HEIGHT = 116;

export function autoLayoutJourney(steps: JourneyStep[]): JourneyNodePosition[] {
  return steps.map((step, index) => ({ id: step.id, x: 32 + index * 216, y: 176 }));
}

export function normalizeJourneyPositions(steps: JourneyStep[], positions: JourneyNodePosition[] = []): JourneyNodePosition[] {
  const saved = new Map(positions.map((position) => [position.id, position]));
  return autoLayoutJourney(steps).map((fallback) => {
    const position = saved.get(fallback.id);
    return position && Number.isFinite(position.x) && Number.isFinite(position.y)
      ? { id: fallback.id, x: clamp(position.x, 24, 1800), y: clamp(position.y, 96, 720) }
      : fallback;
  });
}

export function moveJourneyNode(positions: JourneyNodePosition[], id: string, x: number, y: number): JourneyNodePosition[] {
  return positions.map((position) => position.id === id
    ? { ...position, x: clamp(x, 24, 1800), y: clamp(y, 96, 720) }
    : position);
}

export function buildJourneyEdges(steps: JourneyStep[]): JourneyFlowEdge[] {
  return steps.slice(0, -1).map((step, index) => ({
    id: `${step.id}-${steps[index + 1].id}`,
    from: step.id,
    to: steps[index + 1].id,
    label: step.extracts?.length
      ? step.extracts.map(({ key }) => key).join(' · ')
      : `on ${step.expectedStatus}`,
  }));
}

export function flowEdgePath(from: JourneyNodePosition, to: JourneyNodePosition) {
  const x1 = from.x + FLOW_NODE_WIDTH;
  const y1 = from.y + FLOW_NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + FLOW_NODE_HEIGHT / 2;
  const curve = Math.max(56, Math.abs(x2 - x1) * .45);
  return `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
