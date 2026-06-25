import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

interface ScenarioEdgeData {
  active?: boolean;
  label?: string;
}

const EDGE_RADIUS = 12;

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
  const edgeData = (data ?? {}) as ScenarioEdgeData;
  const active = edgeData.active ?? false;
  const label = edgeData.label?.trim();
  const labelWidth = Math.min(220, Math.max(84, (label?.length ?? 0) * 6.4));
  const [path, labelCenterX, labelCenterY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: EDGE_RADIUS,
  });
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
