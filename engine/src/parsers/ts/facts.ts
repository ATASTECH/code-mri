import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import { extractApiCalls, extractAxiosClients, type ApiCall } from "./apiCalls.js";
import { type DeclKind, extractDeclarations } from "./declarations.js";

/**
 * Per-file facts derived purely from a single file's content. These are
 * serializable (no ts-morph nodes) so they can be content-hash cached and the
 * graph can be rebuilt without re-parsing unchanged files.
 */
export interface DeclFact {
  name: string;
  /** Declaration kind before Next.js page-export promotion. */
  rawKind: DeclKind;
  line: number;
  isExported: boolean;
  isDefaultExport: boolean;
  /** JSX tag names rendered inside this declaration. */
  jsxTags: string[];
  /** Identifier names called inside this declaration (hook detection). */
  hookCallNames: string[];
  /** Identifier names called inside this declaration (function-level call graph). */
  functionCallNames: string[];
  /** API calls made inside this declaration. */
  apiCalls: ApiCall[];
  /** Type/interface names referenced by props, params, returns, or annotations. */
  typeNames: string[];
  /** React contexts provided via `<SomeContext.Provider>`. */
  contextProviders: string[];
  /** React contexts consumed via `useContext(SomeContext)`. */
  contextReads: string[];
  /** Property names read inside this declaration, used for field-level impact heuristics. */
  fieldReadNames: string[];
}

export interface TypeFact {
  name: string;
  kind: "interface" | "type";
  line: number;
  isExported: boolean;
  typeNames: string[];
  fields: string[];
}

export interface ContextFact {
  name: string;
  line: number;
  isExported: boolean;
}

export interface ImportFact {
  specifier: string;
  defaultName?: string;
  named: { name: string; alias?: string }[];
}

export interface ReExportFact {
  /** Module specifier being re-exported from (e.g. "./Button"). */
  source: string;
  /** `export * from "..."` — re-export every named export of the source. */
  star: boolean;
  /** Named re-exports for `export { a, b as c } from "..."`. */
  named: { name: string; alias?: string }[];
}

export interface DynamicImportFact {
  /** Module specifier inside `import("...")`. */
  source: string;
  /** Variable the dynamic import is bound to, if any (e.g. `const X = dynamic(...)`). */
  localName?: string;
}

export interface TsFileFacts {
  rel: string;
  decls: DeclFact[];
  /** API calls not contained by an extracted declaration; caller falls back to the File node. */
  fileApiCalls: ApiCall[];
  types: TypeFact[];
  contexts: ContextFact[];
  imports: ImportFact[];
  reExports: ReExportFact[];
  dynamicImports: DynamicImportFact[];
  axiosClients: Record<string, string>;
}

function apiCallKey(call: ApiCall): string {
  return `${call.line}:${call.method}:${call.client}:${call.url}`;
}

const IGNORED_TYPE_NAMES = new Set([
  "Array",
  "Boolean",
  "Date",
  "FC",
  "Function",
  "HTMLAttributes",
  "MouseEvent",
  "Node",
  "Number",
  "Promise",
  "React",
  "ReactNode",
  "Record",
  "String",
]);

const IGNORED_FIELD_READS = new Set([
  "catch",
  "data",
  "filter",
  "finally",
  "forEach",
  "get",
  "json",
  "length",
  "map",
  "post",
  "push",
  "reduce",
  "slice",
  "then",
  "toString",
  "trim",
]);

function typeReferenceNames(node: Node): string[] {
  const out = new Set<string>();
  for (const ref of node.getDescendantsOfKind(SyntaxKind.TypeReference)) {
    const text = ref.getText();
    for (const [name] of text.matchAll(/\b[A-Z][A-Za-z0-9_$]*\b/g)) {
      if (!IGNORED_TYPE_NAMES.has(name)) out.add(name);
    }
  }
  return [...out];
}

function objectTypeFields(node: Node): string[] {
  const fields = new Set<string>();
  for (const prop of node.getDescendantsOfKind(SyntaxKind.PropertySignature)) {
    const name = prop.getNameNode().getText().replace(/^["']|["']$/g, "");
    if (/^[A-Za-z_$][\w$]*$/.test(name)) {
      fields.add(name);
    }
  }
  return [...fields];
}

function fieldReadNames(node: Node): string[] {
  const fields = new Set<string>();
  for (const access of node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const name = access.getName();
    if (!/^[a-zA-Z_][\w$]*$/.test(name) || IGNORED_FIELD_READS.has(name)) continue;
    fields.add(name);
  }
  return [...fields];
}

function reactContextName(callArg: Node | undefined): string | undefined {
  if (!callArg) return undefined;
  const text = callArg.getText();
  return /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(text) ? text.split(".")[0] : undefined;
}

function isCreateContextCall(node: Node | undefined): boolean {
  if (!node || !Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  const text = expr.getText();
  return text === "createContext" || text.endsWith(".createContext");
}

/** Extract all content-derived facts from a parsed source file. */
export function extractTsFacts(sf: SourceFile, rel: string): TsFileFacts {
  const decls: DeclFact[] = extractDeclarations(sf).map((d) => {
    const jsxTags = [
      ...d.node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
      ...d.node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ].map((tag) => tag.getTagNameNode().getText());

    const hookCallNames: string[] = [];
    const functionCallNames: string[] = [];
    const contextReads: string[] = [];
    for (const call of d.node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (expr.getKind() === SyntaxKind.Identifier) {
        const name = expr.getText();
        hookCallNames.push(name);
        functionCallNames.push(name);
      }
      const exprText = expr.getText();
      if (exprText === "useContext" || exprText.endsWith(".useContext")) {
        const name = reactContextName(call.getArguments()[0]);
        if (name) contextReads.push(name);
      }
    }

    return {
      name: d.name,
      rawKind: d.kind,
      line: d.line,
      isExported: d.isExported,
      isDefaultExport: d.isDefaultExport,
      jsxTags,
      hookCallNames,
      functionCallNames,
      apiCalls: extractApiCalls(d.node),
      typeNames: typeReferenceNames(d.node),
      contextProviders: jsxTags
        .filter((tag) => tag.endsWith(".Provider"))
        .map((tag) => tag.slice(0, -".Provider".length)),
      contextReads,
      fieldReadNames: fieldReadNames(d.node),
    };
  });
  const declApiCallKeys = new Set(
    decls.flatMap((decl) => decl.apiCalls.map(apiCallKey)),
  );
  const fileApiCalls = extractApiCalls(sf).filter(
    (call) => !declApiCallKeys.has(apiCallKey(call)),
  );

  const types: TypeFact[] = [
    ...sf.getInterfaces().map((iface) => ({
      name: iface.getName(),
      kind: "interface" as const,
      line: iface.getStartLineNumber(),
      isExported: iface.isExported(),
      typeNames: typeReferenceNames(iface),
      fields: objectTypeFields(iface),
    })),
    ...sf.getTypeAliases().map((alias) => ({
      name: alias.getName(),
      kind: "type" as const,
      line: alias.getStartLineNumber(),
      isExported: alias.isExported(),
      typeNames: typeReferenceNames(alias),
      fields: alias.getTypeNode() ? objectTypeFields(alias.getTypeNode() as Node) : [],
    })),
  ];

  const contexts: ContextFact[] = [];
  for (const stmt of sf.getVariableStatements()) {
    const isExported = stmt.isExported();
    for (const decl of stmt.getDeclarations()) {
      if (!isCreateContextCall(decl.getInitializer())) continue;
      contexts.push({
        name: decl.getName(),
        line: decl.getStartLineNumber(),
        isExported,
      });
    }
  }

  const imports: ImportFact[] = sf.getImportDeclarations().map((imp) => ({
    specifier: imp.getModuleSpecifierValue(),
    defaultName: imp.getDefaultImport()?.getText(),
    named: imp.getNamedImports().map((ni) => ({
      name: ni.getName(),
      alias: ni.getAliasNode()?.getText(),
    })),
  }));

  const reExports: ReExportFact[] = [];
  for (const ed of sf.getExportDeclarations()) {
    const source = ed.getModuleSpecifierValue();
    if (!source) continue; // local `export { x }` (no `from`) — not a re-export
    // `export * as ns from "./x"` exposes a single namespace binding, not flat
    // members — do not flatten (would create spurious edges).
    if (ed.getNamespaceExport()) continue;
    const named = ed.getNamedExports().map((ne) => ({
      name: ne.getName(),
      alias: ne.getAliasNode()?.getText(),
    }));
    reExports.push({ source, star: named.length === 0, named });
  }

  // Dynamic imports: `import("./x")`, including those wrapped by next/dynamic
  // or React.lazy (`const X = dynamic(() => import("./x"))`).
  const dynamicImports: DynamicImportFact[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
    const [arg] = call.getArguments();
    if (!arg || !Node.isStringLiteral(arg)) continue; // non-literal specifier
    const source = arg.getLiteralText();
    const rawName = call.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName();
    const localName = rawName && /^[A-Za-z_$][\w$]*$/.test(rawName) ? rawName : undefined;
    dynamicImports.push({ source, localName });
  }

  return {
    rel,
    decls,
    fileApiCalls,
    types,
    contexts,
    imports,
    reExports,
    dynamicImports,
    axiosClients: extractAxiosClients(sf),
  };
}
