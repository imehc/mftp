// 自建最小 FBX ASCII 夹具，无外部模型或许可依赖。
export function fbxFixture({
  path,
  unit = 1,
  upAxis = 1,
  embedded,
}: { path?: string; unit?: number; upAxis?: number; embedded?: string } = {}) {
  return new TextEncoder().encode(`; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXVersion: 7400
}
GlobalSettings:  {
\tProperties70:  {
\t\tP: "UnitScaleFactor", "double", "Number", "",${unit}
\t\tP: "UpAxis", "int", "Integer", "",${upAxis}
\t}
}
Objects:  {
\tGeometry: 1, "Geometry::Triangle", "Mesh" {
\t\tVertices: *9 {
\t\t\ta: 0,0,0,100,0,0,0,100,0
\t\t}
\t\tPolygonVertexIndex: *3 {
\t\t\ta: 0,1,-3
\t\t}
\t}
\tModel: 2, "Model::Triangle", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0
\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0
\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1
\t\t}
\t}
${
  path
    ? `\tMaterial: 3, "Material::Surface", "" {
\t\tShadingModel: "phong"
\t}
\tVideo: 4, "Video::Image", "Clip" {
\t\tFilename: "${path}"
\t\tRelativeFilename: "${path}"
${
  embedded
    ? `\t\tContent: ,
"${embedded}"
`
    : ""
}\t}
\tTexture: 5, "Texture::Image", "" {
\t\tFileName: "${path}"
\t}`
    : ""
}
}
Connections:  {
\tC: "OO",1,2
\tC: "OO",2,0
${path ? '\tC: "OO",3,2\n\tC: "OP",5,3,"DiffuseColor"\n\tC: "OO",4,5' : ""}
}
`).buffer;
}
