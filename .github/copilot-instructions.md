## Rules
- Never `git add/commit` files under `.vscode/tasks` (creating is fine).
- Assume no backward compatibility unless explicitly asked.
- Use `claude-haiku-4.5` for simple exploration tasks. Use `claude-sonnet-4.6` for complex exploration tasks.
- By default, focus on CoC (Copilot of Copilot) packages such as `packages/coc/`, `packages/coc-client/`, `packages/coc-workflow/`, `packages/coc-agent-sdk/`, and `packages/forge/`.
- When the plan involves UI/UX, make sure to include the visual design in the plan.
- When fixing the tests, check commit history to see if the test was broken by a previous commit. And if the commit is a new feature or behaivor change and is intentional. You SHOULD gather more information and make a decision on whether to fix the test or the source code.
- Never include personal or privacy data (e.g., real names, emails, usernames, API keys, tokens, passwords, internal URLs, absolute local paths like `/Users/<name>/...`) in commit messages, code comments, or checked-in code. Use placeholders, relative paths, or anonymized values instead.

## Project Principles
- CoC (Copilot of Copilot) is a standalone Node CLI/server and web dashboard.
- CoC is independent of the deep-wiki CLI, but may invoke it as a child process.
- run `npm run build` to build the workspace packages
- run `npm run test` to run all the tests
- Do not reinvent the wheel. Use the existing code and documentation to build the new features if possible.
- New feature (e.g. in development) flag must be disabled by default. 
- Any code change (not documentation) should be using the `impl` skill.
