# MCP Agent Context Router Evals

Use these read-only eval cases to check whether an AI coding agent uses Code MRI
as a context router instead of reading broad source. Each case should start with
`scan_project` or `load_report`, then prefer:

```text
prepare_edit_context -> read_windows -> review_planned_change -> review_diff -> recommend_tests
```

## Eval Cases

1. Change a frontend page that calls a backend users endpoint.
   - Expected tools: `prepare_edit_context`, `read_windows`, `review_planned_change`, `review_diff`, `recommend_tests`
   - Expected must-read: page file, API client/hook, matched backend route or endpoint
   - Expected tests: frontend package test/typecheck and `git diff --check`

2. Remove a serializer field exposed by an API response.
   - Expected tools: `prepare_edit_context`, `impact_query`, `review_planned_change`
   - Expected must-read: model field, serializer, frontend response consumer
   - Expected risk: `BREAKING_FIELD_REMOVED` or response-field impact

3. Rename a backend route method from `GET` to `POST`.
   - Expected tools: `prepare_edit_context`, `check_breaking_changes`, `review_diff`
   - Expected must-read: route/controller/view, frontend caller, OpenAPI route if present
   - Expected risk: method mismatch or breaking route method change

4. Modify a high-churn hook or service.
   - Expected tools: `prepare_edit_context`, `read_windows`, `recommend_tests`
   - Expected must-read: hotspot node file, direct callers, nearby test file
   - Expected signal: hotspot reason or high impact

5. Fix an unmatched frontend API call.
   - Expected tools: `graph_search`, `prepare_edit_context`, `review_diff`
   - Expected must-read: API call site, backend route candidates, config/base URL file
   - Expected risk: `DANGLING_API_CALL`

6. Edit a boundary-sensitive module.
   - Expected tools: `prepare_edit_context`, `review_planned_change`
   - Expected must-read: changed file, dependency edge source/target, `.codemri.yml`
   - Expected risk: `BOUNDARY_VIOLATION` when applicable

7. Clean a dead-code candidate.
   - Expected tools: `find_dead_code`, `prepare_edit_context`, `review_diff`
   - Expected must-read: candidate node, any importers/callers, public API config
   - Expected tests: package test/typecheck and `git diff --check`

8. Change a shared engine public type.
   - Expected tools: `prepare_edit_context`, `recommend_tests`, `review_diff`
   - Expected must-read: `engine/src/types.ts`, engine API export, desktop consumer
   - Expected tests: engine build/typecheck and desktop typecheck

9. Review an agent-produced diff before handoff.
   - Expected tools: `review_diff`, `recommend_tests`
   - Expected must-read: only changed file windows and impacted nodes
   - Expected output: `safeToProceed`, `mustFix`, `shouldCheck`, `verificationCommands`

10. Work in a split frontend/backend project.
    - Expected tools: `scan_project` with `repos`, `prepare_edit_context`, `impact_query`
    - Expected must-read: prefixed frontend path and matching prefixed backend path
    - Expected behavior: no full repository source dump; use line windows only

## Pass Criteria

- The agent does not read whole repositories or large files before calling
  `prepare_edit_context`.
- The first source read is limited to `mustRead` windows.
- `resultStats.omitted` or `nextQueries` drives follow-up calls when context is
  incomplete.
- Secret candidate lines remain redacted in `read_windows` output.
- Verification commands come from `recommend_tests` or `review_diff`.
