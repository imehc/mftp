export type SceneNode = {
  id: string;
  name: string;
  type: string;
  parent: string | null;
  children: string[];
  materials: string[];
};

export type InspectionViewState = {
  tab: string;
  expanded: Set<string>;
  selected: string;
  active: string | null;
  offset: number;
};

export type MaterialInfo = {
  id: string;
  name: string;
  type: string;
  color: string | null;
  opacity: number;
  metalness: number | null;
  roughness: number | null;
  doubleSided: boolean;
  textures: { slot: string; id: string }[];
};

export type TextureInfo = {
  id: string;
  name: string;
  width: number | null;
  height: number | null;
  format: string | null;
  slots: string[];
};

export type ModelInspection = {
  root: string;
  nodes: Record<string, SceneNode>;
  materials: MaterialInfo[];
  textures: TextureInfo[];
  counts: {
    vertices: number | null;
    triangles: number | null;
    geometries: number;
    instances: number;
    materials: number;
    textures: number;
    animations: number;
  };
};

export function visibleSceneNodes(
  inspection: ModelInspection,
  expanded: ReadonlySet<string>,
) {
  const rows: {
    node: SceneNode;
    depth: number;
    position: number;
    siblings: number;
  }[] = [];
  const stack = [{ id: inspection.root, depth: 0, position: 1, siblings: 1 }];
  while (stack.length) {
    const entry = stack.pop()!;
    const node = inspection.nodes[entry.id];
    rows.push({ ...entry, node });
    if (expanded.has(node.id)) {
      for (let i = node.children.length - 1; i >= 0; i--)
        stack.push({
          id: node.children[i],
          depth: entry.depth + 1,
          position: i + 1,
          siblings: node.children.length,
        });
    }
  }
  return rows;
}
