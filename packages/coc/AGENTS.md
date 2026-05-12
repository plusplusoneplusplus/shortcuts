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

A completed ask-mode chat can be promoted to a Ralph session in place via
`POST /api/processes/:id/promote-to-ralph`
(`src/server/routes/ralph-promote-routes.ts`). The endpoint attaches a
`grilling`-phase ralph context to the existing process and enqueues a
synthesis follow-up turn (mode=ask, `context.skills=['grill-me']`,
`context.ralph.phase='grilling'`) carrying the prompt produced by
`buildRalphSynthesisPrompt` (`src/server/ralph/synthesis-prompt.ts`). The SPA
shows a "Promote to Ralph" pill in the follow-up area for eligible chats and
calls this endpoint via `coc-client`'s `processes.promoteToRalph` helper.
