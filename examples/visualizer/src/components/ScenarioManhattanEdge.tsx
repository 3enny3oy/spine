import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";

interface ScenarioEdgeData {
  lane?: number;
  active?: boolean;
  label?: string;
  orientation?: "row" | "wrap";
}

export function ScenarioManhattanEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerEnd,
  style,
  data,
}: EdgeProps) {
  const edgeData = (data ?? {}) as ScenarioEdgeData;
  const lane = edgeData.lane ?? 0;
  const active = edgeData.active ?? false;
  const sameRow = edgeData.orientation === "row" || Math.abs(sourceY - targetY) < 2;
  const laneOffset = lane * 14;

  const [path] = sameRow
    ? getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        curvature: 0.16 + lane * 0.02,
      })
    : [buildWrapPath(sourceX, sourceY, targetX, targetY, laneOffset)];
  const label = edgeData.label?.trim();
  const labelWidth = Math.min(220, Math.max(84, (label?.length ?? 0) * 6.4));
  const labelCenterX = sameRow ? sourceX + (targetX - sourceX) / 2 : sourceX + (targetX - sourceX) / 2;
  const labelX = labelCenterX - labelWidth / 2;
  const labelY = sameRow
    ? sourceY - 30 - lane * 6
    : sourceY + (targetY - sourceY) / 2 - 18 - lane * 6;
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

function buildWrapPath(sourceX: number, sourceY: number, targetX: number, targetY: number, laneOffset: number) {
  const exitDistance = 56 + laneOffset;
  const entryDistance = 56 + laneOffset;
  const verticalSign = targetY >= sourceY ? 1 : -1;
  const wrapY = sourceY + (targetY - sourceY) / 2 + verticalSign * laneOffset * 0.4;
  const exitX = sourceX + exitDistance;
  const entryX = targetX - entryDistance;

  const points = [
    { x: sourceX, y: sourceY },
    { x: exitX, y: sourceY },
    { x: exitX, y: wrapY },
    { x: entryX, y: wrapY },
    { x: entryX, y: targetY },
    { x: targetX, y: targetY },
  ];

  return buildRoundedPolyline(points, 14);
}

function buildRoundedPolyline(points: Array<{ x: number; y: number }>, radius: number) {
  if (points.length < 2) {
    return "";
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    if (!next) {
      path += ` L ${current.x} ${current.y}`;
      continue;
    }

    const inDx = current.x - previous.x;
    const inDy = current.y - previous.y;
    const outDx = next.x - current.x;
    const outDy = next.y - current.y;

    const inLength = Math.abs(inDx) + Math.abs(inDy);
    const outLength = Math.abs(outDx) + Math.abs(outDy);
    const turn = Math.min(radius, inLength / 2, outLength / 2);

    const entryX = current.x - Math.sign(inDx || 0) * turn;
    const entryY = current.y - Math.sign(inDy || 0) * turn;
    const exitX = current.x + Math.sign(outDx || 0) * turn;
    const exitY = current.y + Math.sign(outDy || 0) * turn;

    path += ` L ${entryX} ${entryY}`;
    path += ` Q ${current.x} ${current.y} ${exitX} ${exitY}`;
  }

  return path;
}
