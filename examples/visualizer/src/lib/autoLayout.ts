import ELK from "elkjs/lib/elk.bundled.js";
import { Position, type Node } from "@xyflow/react";
import type { ScenarioEdgeDefinition } from "./scenarios";
import type { DemoNodeData } from "./types";

const elk = new ELK();

const DEFAULT_NODE_WIDTH = 250;
const DEFAULT_NODE_HEIGHT = 164;
const DEFAULT_GROUP_WIDTH = 720;
const DEFAULT_GROUP_HEIGHT = 260;
const ELK_LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "140",
  "elk.spacing.nodeNode": "90",
  "elk.spacing.componentComponent": "160",
  "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
} as const;

const GROUP_LAYOUT_OPTIONS = {
  "elk.padding": "[top=72,left=40,bottom=40,right=40]",
} as const;

export async function layoutScenarioNodes(
  nodes: Node<DemoNodeData>[],
  edges: ScenarioEdgeDefinition[],
): Promise<Node<DemoNodeData>[]> {
  if (!nodes.length) {
    return nodes;
  }

  const visibleNodes = nodes.filter((node) => !node.hidden);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  );

  const childrenByParentId = new Map<string, Node<DemoNodeData>[]>();
  for (const node of visibleNodes) {
    if (!node.parentId) {
      continue;
    }

    const siblings = childrenByParentId.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParentId.set(node.parentId, siblings);
  }

  const topLevelNodes = visibleNodes.filter((node) => !node.parentId);

  const layout = await elk.layout({
    id: "root",
    layoutOptions: ELK_LAYOUT_OPTIONS,
    children: topLevelNodes.map((node) => buildElkNode(node, childrenByParentId)),
    edges: visibleEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  });

  const positions = new Map<string, { x: number; y: number; width?: number; height?: number }>();
  collectLayoutPositions(layout.children ?? [], positions);

  return nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position) {
      return node;
    }

    return {
      ...node,
      position: {
        x: position.x,
        y: position.y,
      },
      style:
        node.data.kind === "group"
          ? {
              ...(node.style ?? {}),
              width: position.width ?? node.style?.width ?? DEFAULT_GROUP_WIDTH,
              height: position.height ?? node.style?.height ?? DEFAULT_GROUP_HEIGHT,
            }
          : node.style,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

function buildElkNode(
  node: Node<DemoNodeData>,
  childrenByParentId: Map<string, Node<DemoNodeData>[]>,
) {
  const children = (childrenByParentId.get(node.id) ?? []).map((child) => buildElkNode(child, childrenByParentId));
  const isGroup = node.data.kind === "group";

  return {
    id: node.id,
    width: getNodeWidth(node, isGroup),
    height: getNodeHeight(node, isGroup),
    layoutOptions: isGroup ? GROUP_LAYOUT_OPTIONS : undefined,
    children: children.length ? children : undefined,
  };
}

function getNodeWidth(node: Node<DemoNodeData>, isGroup: boolean) {
  if (isGroup) {
    return readNodeDimension(node.style?.width) ?? node.measured?.width ?? node.width ?? DEFAULT_GROUP_WIDTH;
  }

  return node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH;
}

function getNodeHeight(node: Node<DemoNodeData>, isGroup: boolean) {
  if (isGroup) {
    return readNodeDimension(node.style?.height) ?? node.measured?.height ?? node.height ?? DEFAULT_GROUP_HEIGHT;
  }

  return node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT;
}

function readNodeDimension(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function collectLayoutPositions(
  layoutNodes: Array<{ id?: string; x?: number; y?: number; width?: number; height?: number; children?: any[] }>,
  positions: Map<string, { x: number; y: number; width?: number; height?: number }>,
) {
  for (const node of layoutNodes) {
    if (!node.id) {
      continue;
    }

    positions.set(node.id, {
      x: Math.round(node.x ?? 0),
      y: Math.round(node.y ?? 0),
      width: typeof node.width === "number" ? Math.round(node.width) : undefined,
      height: typeof node.height === "number" ? Math.round(node.height) : undefined,
    });

    if (node.children?.length) {
      collectLayoutPositions(node.children, positions);
    }
  }
}
