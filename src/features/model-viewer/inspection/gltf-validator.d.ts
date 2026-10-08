declare module "gltf-validator" {
  export function validateBytes(
    bytes: Uint8Array,
    options: {
      maxIssues: number;
      writeTimestamp: boolean;
      externalResourceFunction: (uri: string) => Promise<Uint8Array>;
    },
  ): Promise<import("./types").ValidationReport>;
}
