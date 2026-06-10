import {
  type CallExpression,
  Node,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";

export interface ApiCall {
  /** HTTP verb, uppercased. */
  method: string;
  /** Raw url literal or `{param}`-normalized pattern. */
  url: string;
  /** Identifier the call was made on: "api", "axios", "fetch", ... */
  client: string;
  /** True when the url came from a template literal with interpolation. */
  dynamic: boolean;
  /** 1-based line. */
  line: number;
  /** Response fields read from this API call within the same declaration scope. */
  responseFields?: ApiResponseFieldUse[];
}

export interface ApiResponseFieldUse {
  field: string;
  line: number;
  confidence: "medium" | "low";
}

/** Clients callable directly as `client(url, options)` (fetch-style). */
const DIRECT_CLIENTS = new Set(["fetch", "ky", "got"]);

const VERBS: Record<string, string> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
};

/** Looks like a request path / URL rather than an arbitrary string key. */
function looksLikeUrl(url: string): boolean {
  return url.startsWith("/") || /^https?:\/\//.test(url);
}

/** Extract a url string + dynamic flag from a call argument, or null. */
function urlFromArg(arg: Node | undefined): { url: string; dynamic: boolean } | null {
  if (!arg) return null;
  const kind = arg.getKind();
  if (kind === SyntaxKind.StringLiteral) {
    return { url: arg.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue(), dynamic: false };
  }
  if (kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    return { url: arg.getText().slice(1, -1), dynamic: false };
  }
  if (kind === SyntaxKind.TemplateExpression) {
    const inner = arg.getText().slice(1, -1).replace(/\$\{[^}]*\}/g, "{param}");
    return { url: inner, dynamic: true };
  }
  return null;
}

/** Read a string `method:` property from a fetch options object literal. */
function methodFromOptions(arg: Node | undefined): string | null {
  if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) return null;
  const obj = arg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression);
  const prop = obj.getProperty("method");
  if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) return null;
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
  if (init?.getKind() === SyntaxKind.StringLiteral) {
    return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue().toUpperCase();
  }
  return null;
}

function fromCall(call: CallExpression): ApiCall | null {
  const expr = call.getExpression();
  const args = call.getArguments();
  const line = call.getStartLineNumber();

  // <client>.<verb>(url, ...)
  if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
    const pae = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    const method = VERBS[pae.getName()];
    if (!method) return null;
    const parsed = urlFromArg(args[0]);
    if (!parsed || !looksLikeUrl(parsed.url)) return null;
    return { method, url: parsed.url, client: pae.getExpression().getText(), dynamic: parsed.dynamic, line };
  }

  // fetch/ky/got direct call: client(url, { method })
  if (expr.getKind() === SyntaxKind.Identifier && DIRECT_CLIENTS.has(expr.getText())) {
    const parsed = urlFromArg(args[0]);
    if (!parsed || !looksLikeUrl(parsed.url)) return null;
    const method = methodFromOptions(args[1]) ?? "GET";
    return { method, url: parsed.url, client: expr.getText(), dynamic: parsed.dynamic, line };
  }

  return null;
}

function unwrapAwait(node: Node | undefined): Node | undefined {
  if (!node) return undefined;
  return node.getKind() === SyntaxKind.AwaitExpression
    ? node.asKindOrThrow(SyntaxKind.AwaitExpression).getExpression()
    : node;
}

function fieldName(name: string): string | null {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : null;
}

function addField(
  fields: Map<CallExpression, Map<string, ApiResponseFieldUse>>,
  call: CallExpression,
  field: string,
  line: number,
  confidence: ApiResponseFieldUse["confidence"],
): void {
  const name = fieldName(field);
  if (!name || ["data", "filter", "forEach", "length", "map", "reduce"].includes(name)) return;
  const byName = fields.get(call) ?? new Map<string, ApiResponseFieldUse>();
  const existing = byName.get(name);
  if (!existing || existing.confidence === "low") {
    byName.set(name, { field: name, line, confidence });
  }
  fields.set(call, byName);
}

function boundCall(
  node: Node | undefined,
  parsed: Map<CallExpression, ApiCall>,
): CallExpression | undefined {
  const expr = unwrapAwait(node);
  return expr && Node.isCallExpression(expr) && parsed.has(expr) ? expr : undefined;
}

function responseDataCall(
  node: Node | undefined,
  responseVars: Map<string, CallExpression>,
): CallExpression | undefined {
  if (!node || !Node.isPropertyAccessExpression(node) || node.getName() !== "data") {
    return undefined;
  }
  const base = node.getExpression();
  return Node.isIdentifier(base) ? responseVars.get(base.getText()) : undefined;
}

function collectPropertyReads(
  node: Node,
  responseVars: Map<string, CallExpression>,
  dataVars: Map<string, CallExpression>,
  fields: Map<CallExpression, Map<string, ApiResponseFieldUse>>,
): void {
  for (const access of node.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    const expr = access.getExpression();
    if (Node.isIdentifier(expr)) {
      const call = dataVars.get(expr.getText());
      if (call) addField(fields, call, access.getName(), access.getStartLineNumber(), "medium");
      continue;
    }
    const call = responseDataCall(expr, responseVars);
    if (call) addField(fields, call, access.getName(), access.getStartLineNumber(), "medium");
  }

  for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== "map") continue;
    const base = expr.getExpression();
    const apiCall = Node.isIdentifier(base)
      ? dataVars.get(base.getText())
      : responseDataCall(base, responseVars);
    if (!apiCall) continue;
    const callback = call.getArguments()[0];
    if (!callback || !(Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))) continue;
    const param = callback.getParameters()[0]?.getName();
    if (!param) continue;
    for (const access of callback.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
      const owner = access.getExpression();
      if (Node.isIdentifier(owner) && owner.getText() === param) {
        addField(fields, apiCall, access.getName(), access.getStartLineNumber(), "low");
      }
    }
  }
}

/**
 * Find every HTTP API call (axios/fetch/custom client) within a node.
 * Accepts any node (a SourceFile, or a single declaration body) so the analyzer
 * can attribute calls to their enclosing component/hook.
 */
export function extractApiCalls(scope: Node): ApiCall[] {
  const apiCalls = new Map<CallExpression, ApiCall>();
  for (const call of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const apiCall = fromCall(call);
    if (apiCall) apiCalls.set(call, apiCall);
  }

  const responseVars = new Map<string, CallExpression>();
  const dataVars = new Map<string, CallExpression>();
  const fields = new Map<CallExpression, Map<string, ApiResponseFieldUse>>();

  for (const decl of scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    const call = boundCall(init, apiCalls);
    const nameNode = decl.getNameNode();
    if (call) {
      if (Node.isIdentifier(nameNode)) {
        responseVars.set(nameNode.getText(), call);
      } else if (Node.isObjectBindingPattern(nameNode)) {
        for (const element of nameNode.getElements()) {
          if (element.getNameNode().getText() === "data") {
            dataVars.set(element.getName(), call);
          }
        }
      }
      continue;
    }

    if (Node.isIdentifier(nameNode)) {
      const dataCall = responseDataCall(init, responseVars);
      if (dataCall) dataVars.set(nameNode.getText(), dataCall);
      if (init && Node.isIdentifier(init)) {
        const aliasCall = dataVars.get(init.getText());
        if (aliasCall) dataVars.set(nameNode.getText(), aliasCall);
      }
    }
  }

  collectPropertyReads(scope, responseVars, dataVars, fields);

  for (const thenCall of scope.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = thenCall.getExpression();
    if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== "then") continue;
    const source = expr.getExpression();
    if (!Node.isCallExpression(source) || !apiCalls.has(source)) continue;
    const callback = thenCall.getArguments()[0];
    if (!callback || !(Node.isArrowFunction(callback) || Node.isFunctionExpression(callback))) continue;
    const param = callback.getParameters()[0]?.getName();
    if (!param) continue;
    collectPropertyReads(callback, new Map([[param, source]]), new Map(), fields);
  }

  return [...apiCalls].map(([call, apiCall]) => {
    const responseFields = [...(fields.get(call)?.values() ?? [])];
    return responseFields.length ? { ...apiCall, responseFields } : apiCall;
  });
}

/**
 * Map axios client variables to their configured baseURL, e.g.
 * `const api = axios.create({ baseURL: "/api" })` -> `{ api: "/api" }`.
 * The linker prepends this to relative call urls. Resolution is by variable
 * name (V1 limitation; see docs/limitations.md).
 */
export function extractAxiosClients(sf: SourceFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of sf.getVariableDeclarations()) {
    const init = decl.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.CallExpression) continue;
    const call = init.asKindOrThrow(SyntaxKind.CallExpression);
    if (call.getExpression().getText() !== "axios.create") continue;
    const optArg = call.getArguments()[0];
    if (!optArg || optArg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
    const prop = optArg.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty("baseURL");
    if (!prop || prop.getKind() !== SyntaxKind.PropertyAssignment) continue;
    const value = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer();
    if (value?.getKind() === SyntaxKind.StringLiteral) {
      out[decl.getName()] = value.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue();
    }
  }
  return out;
}
