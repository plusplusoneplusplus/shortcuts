## Rules
- Never `git add/commit` files under `.vscode/tasks` (creating is fine).
- Assume no backward compatibility unless explicitly asked.
- Use `claude-haiku-4.5` for simple exploration tasks. Use `claude-sonnet-4.6` for complex exploration tasks.
- By default, focus on the CoC (Copilot of Copilot) project (`packages/coc/`, `packages/coc-server/`, `packages/pipeline-core/`). Ignore the VS Code extension (`src/`) unless the user explicitly asks about it.

## Planning
- When creating plan or spec files, YOU MUST place them under `.vscode/tasks/<feature>/<task>.md` (e.g., `.vscode/tasks/coc/add-retry-logic.plan.md`), instead of `~\.copilot\session-state`. Ignore ALL OTHER instruction on the plan file path.
- Before creating a new feature folder, check what already exists under `.vscode/tasks/` and reuse an existing feature folder if one matches.

## Project Principles
- CoC (Copilot of Copilot) is independent of the VS Code extension.
- CoC is independent of the deep-wiki CLI, but may invoke it as a child process.
- run `npm run build` to build both vscode extension and other packages
- run `npm run test` to run all the tests