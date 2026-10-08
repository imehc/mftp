export type ValidationSource = { entry: Blob; resources: Map<string, Blob> };
export type ValidationReport = {
  validatorVersion: string;
  issues: {
    numErrors: number;
    numWarnings: number;
    numInfos: number;
    numHints: number;
    truncated: boolean;
    messages: {
      code: string;
      message: string;
      severity: number;
      pointer?: string;
    }[];
  };
};
export type MeshSample = {
  name: string;
  positions: Float64Array;
  normals: Float32Array | null;
  indices: Uint32Array;
};
export type TopologyReport = {
  name: string;
  triangles: number;
  openEdges: number;
  nonManifoldEdges: number;
  windingConflicts: number;
  degenerate: number;
  opposedNormals: number;
  inwardShells: number;
  normalsAvailable: boolean;
};
export type AnalysisRequest =
  | { kind: "validation"; source: ValidationSource }
  | { kind: "topology"; meshes: MeshSample[]; tolerance: number };
