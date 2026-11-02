import { readFileSync, writeFileSync } from "node:fs";

import ts from "typescript";

const bindingsUrl = new URL("../src/bindings.ts", import.meta.url);
const facadeUrl = new URL("../src/types.ts", import.meta.url);
const bindings = ts.createSourceFile(
  "bindings.ts",
  readFileSync(bindingsUrl, "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const available = new Set(
  bindings.statements.flatMap((statement) =>
    (ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement)) &&
    statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
      ? [statement.name.text]
      : [],
  ),
);
let source = readFileSync(facadeUrl, "utf8");
const facade = ts.createSourceFile(
  "types.ts",
  source,
  ts.ScriptTarget.Latest,
  true,
);

// 只同步已声明的 IPC 再导出，保留门面本地类型，不自行定义后端契约。
for (const statement of [...facade.statements].reverse()) {
  if (
    !ts.isExportDeclaration(statement) ||
    !statement.isTypeOnly ||
    statement.moduleSpecifier?.text !== "~/bindings" ||
    !statement.exportClause ||
    !ts.isNamedExports(statement.exportClause)
  )
    continue;
  const retained = statement.exportClause.elements.filter((element) =>
    available.has((element.propertyName ?? element.name).text),
  );
  if (retained.length === statement.exportClause.elements.length) continue;
  const replacement = retained.length
    ? `export type {\n${retained.map((element) => `  ${element.getText(facade)},`).join("\n")}\n} from "~/bindings";`
    : "";
  source =
    source.slice(0, statement.getStart(facade)) +
    replacement +
    source.slice(statement.end);
}
writeFileSync(facadeUrl, source);
