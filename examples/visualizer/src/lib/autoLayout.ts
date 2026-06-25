import ELK from "elkjs/lib/elk.bundled.js";
import type { Node } from "@xyflow/react";
import type { ScenarioEdgeDefinition } from "./scenarios";
import type { DemoNodeData } from "./types";

const elk = new ELK();

const DEFAULT_NODE_WIDTH = 250;
const DEFAULT_NODE_HEIGHT = 164;
const BAND_TOLERANCE = 96;
const BAND_STAGGER_STEP = 28;

export async function layoutScenarioNodes(
  nodes: Node<DemoNodeData>[],
  edges: ScenarioEdgeDefinition[],
): Promise<Node<DemoNodeData>[]> {
  if (!nodes.length) {
    return nodes;
  }

  const visibleNodes = nodes.filter((node) => !node.hidden);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const filteredEdges = edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target));
  const bandAnchors = deriveBandAnchors(visibleNodes);
  const layoutedGraph = await elk.layout({
    id: "scenario-root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
      "elk.spacing.nodeNode": "110",
      "elk.spacing.nodeNodeBetweenLayers": "180",
      "elk.layered.spacing.edgeNodeBetweenLayers": "72",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
    },
    children: visibleNodes.map((node) => ({
      id: node.id,
      width: measuredWidth(node),
      height: measuredHeight(node),
    })),
    edges: filteredEdges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
      })),
  });

  const layoutedById = new Map((layoutedGraph.children ?? []).map((node) => [node.id, node]));
  const positions = new Map<string, { x: number; y: number }>();

  for (const bandAnchor of bandAnchors) {
    const bandNodes = visibleNodes
      .filter((node) => bandIndexForNode(node, bandAnchors) === bandIndexForY(bandAnchor, bandAnchors))
      .sort((left, right) => {
        const leftLayout = layoutedById.get(left.id);
        const rightLayout = layoutedById.get(right.id);
        const leftY = leftLayout?.y ?? 0;
        const rightY = rightLayout?.y ?? 0;
        if (leftY !== rightY) {
          return leftY - rightY;
        }
        return left.position.x - right.position.x;
      });

    const centerIndex = (bandNodes.length - 1) / 2;
    for (let index = 0; index < bandNodes.length; index += 1) {
      const node = bandNodes[index];
      positions.set(node.id, {
        x: node.position.x,
        y: Math.round(bandAnchor + (index - centerIndex) * BAND_STAGGER_STEP),
      });
    }
  }

  return nodes.map((node) => {
    const nextPosition = positions.get(node.id);
    if (!nextPosition) {
      return node;
    }
    return {
      ...node,
      position: {
        x: Math.round(nextPosition.x),
        y: Math.round(nextPosition.y),
      },
    };
  });
}

function measuredWidth(node: Node<DemoNodeData>) {
  return node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH;
}

function measuredHeight(node: Node<DemoNodeData>) {
  return node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT;
}

function deriveBandAnchors(nodes: Node<DemoNodeData>[]) {
  const ys = [...new Set(nodes.map((node) => node.position.y))].sort((left, right) => left - right);
  const bands: number[] = [];

  for (const y of ys) {
    const last = bands.at(-1);
    if (last === undefined || Math.abs(y - last) > BAND_TOLERANCE) {
      bands.push(y);
    }
  }

  return bands;
}

function bandIndexForY(y: number, bandAnchors: number[]) {
  return bandAnchors.findIndex((anchor) => anchor === y);
}

function bandIndexForNode(node: Node<DemoNodeData>, bandAnchors: number[]) {
  if (!bandAnchors.length) {
    return 0;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < bandAnchors.length; index += 1) {
    const distance = Math.abs(node.position.y - bandAnchors[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}
