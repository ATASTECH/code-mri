# Security Notes

Code MRI is local-first.

- It does not call an LLM or remote analysis API.
- MCP tools operate on files available to the local process.
- `scan_project` reads source files under the requested project path.
- `scan_project` may write report and cache artifacts under `--state-dir`,
  `--cache-dir`, `reportPath`, or `baselinePath`.
- `recommend_tests` only returns commands as data; it does not execute them.
- `check_breaking_changes`, `impact_query`, `graph_search`, `get_node_context`,
  `find_dead_code`, and `ask_graph` read from the active in-memory report.
- Secret findings are heuristic and masked. They are intended as review prompts,
  not proof that a real secret exists.

For untrusted repositories, run Code MRI in a sandboxed working directory and
keep `--allow-scan` scoped to that repository.
