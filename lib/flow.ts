import type { JourneyStep } from './journey';

export type JourneyNodePosition = { id: string; x: number; y: number };
export type JourneyFlowEdge = { id: string; from: string; to: string; label: string };
export type JourneyViewport = { positions: JourneyNodePosition[]; width: number; height: number };

export const FLOW_NODE_WIDTH = 196;
export const FLOW_NODE_HEIGHT = 124;
const FLOW_MIN_Y = 96;

export function autoLayoutJourney(steps: JourneyStep[]): JourneyNodePosition[] {
  return steps.map((step, index) => ({ id: step.id, x: 32 + index * 244, y: FLOW_MIN_Y }));
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

export function fitJourneyViewport(positions: JourneyNodePosition[], padding = 28): JourneyViewport {
  if (!positions.length) return { positions: [], width: 760, height: 280 };
  const offsetX = 0;
  const offsetY = FLOW_MIN_Y - padding;
  const fitted = positions.map((position) => ({ ...position, x: position.x - offsetX, y: position.y - offsetY }));
  return {
    positions: fitted,
    width: Math.max(760, ...fitted.map(({ x }) => x + FLOW_NODE_WIDTH + padding)),
    height: Math.max(280, ...fitted.map(({ y }) => y + FLOW_NODE_HEIGHT + padding)),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
