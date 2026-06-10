# Limitations (V1)

Code MRI does **pure static analysis** — it never runs the target project. This is
safe and fast, but it means some relationships that only exist at runtime cannot be
recovered with certainty. Known blind spots:

## Django (Python sidecar, `ast`-based)
- **Dynamic serializer fields** — `SerializerMethodField`, fields added in
  `__init__` / `get_fields`, or via `setattr` are not tracked.
- **Dynamic `serializer_class`** — when `get_serializer_class()` branches at runtime,
  only statically referenced classes are linked (each, low confidence).
- **String / lazy model references** — `'app.Model'` references and swappable models
  are matched by name only.
- **Custom routers / programmatic URL building** — non-standard `include()` patterns or
  URLs assembled in loops may be partially resolved.
- **Signals & receivers** — connected via decorators or strings are treated as
  entry points but their downstream calls are not fully traced.

## TypeScript / Next.js (ts-morph)
- **Fully dynamic API calls** — when the URL is computed from runtime data with no
  static prefix, the call is recorded but cross-stack matching is `low` confidence.
- **Indirection through generic clients** — heavily wrapped fetch helpers may hide the
  method/URL; only statically resolvable cases are linked.
- **Runtime-only routing** — components reached purely via runtime route tables may be
  flagged as dead-code *candidates*.

## General
- All dead-code findings are **candidates**, never assertions.
- Cross-stack (frontend ↔ backend) links carry a `confidence` of `high | medium | low`.
  Supplying an OpenAPI schema (`--openapi`) raises confidence by using it as ground truth.
