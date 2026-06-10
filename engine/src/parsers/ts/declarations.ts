import { type Node, type SourceFile, SyntaxKind } from "ts-morph";

export type DeclKind = "Component" | "Hook" | "Function";

export interface DeclInfo {
  name: string;
  kind: DeclKind;
  isExported: boolean;
  isDefaultExport: boolean;
  /** 1-based line of the declaration. */
  line: number;
  /** The function / arrow node, used by the analyzer to scan the body. */
  node: Node;
}

function hasJsx(node: Node): boolean {
  return (
    node.getFirstDescendantByKind(SyntaxKind.JsxElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) !== undefined ||
    node.getFirstDescendantByKind(SyntaxKind.JsxFragment) !== undefined
  );
}

function classify(name: string, jsx: boolean): DeclKind {
  if (/^use[A-Z]/.test(name)) return "Hook";
  if (/^[A-Z]/.test(name) && jsx) return "Component";
  return "Function";
}

/**
 * Extract top-level component / hook / function declarations from a source file.
 * Covers `function` declarations and `const x = () => ...` / function expressions.
 */
export function extractDeclarations(sf: SourceFile): DeclInfo[] {
  const out: DeclInfo[] = [];

  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (!name) continue;
    out.push({
      name,
      kind: classify(name, hasJsx(fn)),
      isExported: fn.isExported(),
      isDefaultExport: fn.isDefaultExport(),
      line: fn.getStartLineNumber(),
      node: fn,
    });
  }

  for (const stmt of sf.getVariableStatements()) {
    const exported = stmt.isExported();
    for (const decl of stmt.getDeclarations()) {
      const init = decl.getInitializer();
      if (!init) continue;
      const kind = init.getKind();
      if (kind !== SyntaxKind.ArrowFunction && kind !== SyntaxKind.FunctionExpression) {
        continue;
      }
      const name = decl.getName();
      out.push({
        name,
        kind: classify(name, hasJsx(init)),
        isExported: exported,
        isDefaultExport: false,
        line: decl.getStartLineNumber(),
        node: init,
      });
    }
  }

  return out;
}
