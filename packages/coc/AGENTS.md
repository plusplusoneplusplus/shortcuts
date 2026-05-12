# packages/coc

CoC CLI and integrated server. Consumes `@plusplusoneplusplus/forge`. See the
root `AGENTS.md` for the cross-package overview, build/test commands, and the
"repo-scoped data" convention. Deeper architecture references live under
`.github/skills/coc-knowledge/`.

## Ralph

Ralph sessions live under
`~/.coc/repos/<workspaceId>/ralph-sessions/<sessionId>/`. Keep the durable
architecture details in `.github/skills/coc-knowledge/references/ralph.md`;
this local file should only carry package-specific pointers and invariants.
