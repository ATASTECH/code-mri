import type { SourceFile } from "ts-morph";

export interface ImportInfo {
  /** The raw module specifier, e.g. "react" or "../hooks/useUsers". */
  moduleSpecifier: string;
  /** Default import binding name, if any. */
  defaultImport?: string;
  /** Named import binding names (local names). */
  namedImports: string[];
  /** Whether the whole declaration is `import type`. */
  isTypeOnly: boolean;
}

/** Extract all static import declarations from a source file. */
export function extractImports(sf: SourceFile): ImportInfo[] {
  return sf.getImportDeclarations().map((decl) => {
    const def = decl.getDefaultImport()?.getText();
    const info: ImportInfo = {
      moduleSpecifier: decl.getModuleSpecifierValue(),
      namedImports: decl.getNamedImports().map((n) => n.getName()),
      isTypeOnly: decl.isTypeOnly(),
    };
    if (def) info.defaultImport = def;
    return info;
  });
}
