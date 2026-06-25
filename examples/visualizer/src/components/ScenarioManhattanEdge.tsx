import {
  BaseEdge,
  getSmoothStepPath,
  useNodes,
  type EdgeProps,
  type Node,
  type XYPosition,
} from "@xyflow/react";
import {
  getSmartEdge,
  pathfindingAStarNoDiagonal,
  svgDrawSmoothStepLinePath,
} from "@tisoap/react-flow-smart-edge";
import type { DemoNodeData } from "../lib/types";

interface ScenarioEdgeData {
  lane?: number;
  laneCount?: number;
  active?: boolean;
  label?: string;
  orientation?: "row" | "wrap";
}

interface Point {
  x: number;
  y: number;
}

const EDGE_RADIUS = 12;
const CHANNEL_BREAKOUT = 16;
const CHANNEL_SPACING = 14;

const SMART_EDGE_OPTIONS = {
  nodePadding: 22,
  gridRatio: 14,
  generatePath: pathfindingAStarNoDiagonal,
  drawEdge: svgDrawSmoothStepLinePath({ borderRadius: EDGE_RADIUS }),
} as const;

const drawSmoothStepPath = svgDrawSmoothStepLinePath({ borderRadius: EDGE_RADIUS });

const pointsEqual = (first: Point, second: Point) =>
  first.x === second.x && first.y === second.y;

const isHorizontal = (start: Point, end: Point) => start.y === end.y;

const segmentLength = (start: Point, end: Point) =>
  Math.abs(isHorizontal(start, end) ? end.x - start.x : end.y - start.y);

const normalizePoints = (points: Point[]) => {
  const deduped = points.filter(
    (point, index) => index === 0 || !pointsEqual(point, points[index - 1]),
  );

  return deduped.reduce<Point[]>((result, point) => {
    if (result.length < 2) {
      result.push(point);
      return result;
    }

    const first = result[result.length - 2];
    const second = result[result.length - 1];
    const sameColumn = first.x === second.x && second.x === point.x;
    const sameRow = first.y === second.y && second.y === point.y;

    if (sameColumn || sameRow) {
      result[result.length - 1] = point;
    } else {
      result.push(point);
    }

    return result;
  }, []);
};

const moveAlongSegment = (from: Point, toward: Point, distance: number): Point => {
  if (from.x === toward.x) {
    return {
      x: from.x,
      y: from.y + Math.sign(toward.y - from.y) * distance,
    };
  }

  return {
    x: from.x + Math.sign(toward.x - from.x) * distance,
    y: from.y,
  };
};

const shiftPerpendicular = (start: Point, end: Point, offset: number): Point => {
  if (isHorizontal(start, end)) {
    return { x: start.x, y: start.y + offset };
  }

  return { x: start.x + offset, y: start.y };
};

const offsetOrthogonalPolyline = (points: Point[], offset: number) => {
  if (points.length < 2 || offset === 0) {
    return points;
  }

  const shiftedSegments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    if (isHorizontal(point, next)) {
      return {
        axis: "horizontal" as const,
        start: { x: point.x, y: point.y + offset },
        end: { x: next.x, y: next.y + offset },
      };
    }

    return {
      axis: "vertical" as const,
      start: { x: point.x + offset, y: point.y },
      end: { x: next.x + offset, y: next.y },
    };
  });

  const routed: Point[] = [shiftedSegments[0].start];

  for (let index = 0; index < shiftedSegments.length - 1; index++) {
    const current = shiftedSegments[index];
    const next = shiftedSegments[index + 1];

    if (current.axis === next.axis) {
      routed.push(current.end);
      continue;
    }

    routed.push(
      current.axis === "horizontal"
        ? { x: next.start.x, y: current.start.y }
        : { x: current.start.x, y: next.start.y },
    );
  }

  routed.push(shiftedSegments[shiftedSegments.length - 1].end);
  return normalizePoints(routed);
};

const midpointAlongPolyline = (points: Point[]) => {
  if (points.length === 0) {
    return { x: 0, y: 0 };
  }

  if (points.length === 1) {
    return points[0];
  }

  const lengths = points.slice(0, -1).map((point, index) => ({
    start: point,
    end: points[index + 1],
    length: segmentLength(point, points[index + 1]),
  }));
  const totalLength = lengths.reduce((sum, segment) => sum + segment.length, 0);
  const halfway = totalLength / 2;

  let walked = 0;
  for (const segment of lengths) {
    if (walked + segment.length >= halfway) {
      const remaining = halfway - walked;
      if (isHorizontal(segment.start, segment.end)) {
        return {
          x: segment.start.x + Math.sign(segment.end.x - segment.start.x) * remaining,
          y: segment.start.y,
        };
      }

      return {
        x: segment.start.x,
        y: segment.start.y + Math.sign(segment.end.y - segment.start.y) * remaining,
      };
    }
    walked += segment.length;
  }

  return points[points.length - 1];
};

const buildChannelPoints = (
  source: Point,
  target: Point,
  smartPoints: number[][],
  lane: number,
  laneCount: number,
) => {
  const basePoints = normalizePoints([
    source,
    ...smartPoints.map(([x, y]) => ({ x, y })),
    target,
  ]);

  if (basePoints.length < 2 || laneCount <= 1) {
    return {
      intermediate: basePoints.slice(1, -1),
      labelCenter: midpointAlongPolyline(basePoints),
    };
  }

  const laneOffset = (lane - (laneCount - 1) / 2) * CHANNEL_SPACING;
  if (Math.abs(laneOffset) < 0.5) {
    return {
      intermediate: basePoints.slice(1, -1),
      labelCenter: midpointAlongPolyline(basePoints),
    };
  }

  const firstSegmentLength = segmentLength(basePoints[0], basePoints[1]);
  const lastSegmentLength = segmentLength(
    basePoints[basePoints.length - 2],
    basePoints[basePoints.length - 1],
  );
  const breakoutStart = Math.min(CHANNEL_BREAKOUT, firstSegmentLength / 2);
  const breakoutEnd = Math.min(CHANNEL_BREAKOUT, lastSegmentLength / 2);

  if (breakoutStart < 1 || breakoutEnd < 1) {
    return {
      intermediate: basePoints.slice(1, -1),
      labelCenter: midpointAlongPolyline(basePoints),
    };
  }

  const startBreak = moveAlongSegment(basePoints[0], basePoints[1], breakoutStart);
  const endBreak = moveAlongSegment(
    basePoints[basePoints.length - 1],
    basePoints[basePoints.length - 2],
    breakoutEnd,
  );
  const corePoints = normalizePoints([
    startBreak,
    ...basePoints.slice(1, -1),
    endBreak,
  ]);

  if (corePoints.length < 2) {
    return {
      intermediate: basePoints.slice(1, -1),
      labelCenter: midpointAlongPolyline(basePoints),
    };
  }

  const offsetCore = offsetOrthogonalPolyline(corePoints, laneOffset);
  const channeledPoints = normalizePoints([
    source,
    startBreak,
    ...offsetCore,
    endBreak,
    target,
  ]);

  return {
    intermediate: channeledPoints.slice(1, -1),
    labelCenter: midpointAlongPolyline(channeledPoints),
  };
};

export function ScenarioManhattanEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const nodes = useNodes<Node<DemoNodeData>>();
  const edgeData = (data ?? {}) as ScenarioEdgeData;
  const active = edgeData.active ?? false;
  const label = edgeData.label?.trim();
  const labelWidth = Math.min(220, Math.max(84, (label?.length ?? 0) * 6.4));
  const sourcePoint: XYPosition = { x: sourceX, y: sourceY };
  const targetPoint: XYPosition = { x: targetX, y: targetY };
  const fallback = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: EDGE_RADIUS,
  });
  const smartResult = getSmartEdge({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    nodes,
    options: SMART_EDGE_OPTIONS,
  });
  const routedChannel =
    smartResult instanceof Error
      ? null
      : buildChannelPoints(
          sourcePoint,
          targetPoint,
          smartResult.points,
          edgeData.lane ?? 0,
          edgeData.laneCount ?? 1,
        );
  const path =
    routedChannel === null
      ? fallback[0]
      : drawSmoothStepPath(
          sourcePoint,
          targetPoint,
          routedChannel.intermediate.map((point) => [point.x, point.y]),
        );
  const labelCenterX =
    routedChannel === null ? fallback[1] : routedChannel.labelCenter.x;
  const labelCenterY =
    routedChannel === null ? fallback[2] : routedChannel.labelCenter.y;
  const labelX = labelCenterX - labelWidth / 2;
  const labelY = labelCenterY - 12;
  const mergedStyle = {
    ...(style ?? {}),
    stroke: active ? "rgba(103,232,249,0.98)" : style?.stroke,
    strokeWidth: active ? 3.2 : style?.strokeWidth,
  };

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={mergedStyle} />
      {label ? (
        <g pointerEvents="none">
          <rect
            x={labelX}
            y={labelY}
            width={labelWidth}
            height={22}
            rx={11}
            fill={active ? "rgba(8,47,73,0.92)" : "rgba(15,23,42,0.88)"}
            stroke={active ? "rgba(103,232,249,0.42)" : "rgba(255,255,255,0.08)"}
          />
          <text
            x={labelCenterX}
            y={labelY + 14}
            textAnchor="middle"
            fontSize="10"
            fontWeight="600"
            fill={active ? "rgba(207,250,254,1)" : "rgba(226,232,240,0.9)"}
          >
            {label}
          </text>
        </g>
      ) : null}
    </>
  );
}
