# EnDev xDPU

Workspace-scoped EnDev xDPU support lives in `packages/coc/src/server/endev/`.

## Eligibility Cache

Eligibility is cached at `~/.coc/repos/<workspaceId>/endev/eligibility.json` and requires **all** of: a native WSL host, xDPU workspace markers in the repo, EnDev setup files present, and a successful short-timeout `endev doctor`.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces/:id/endev/status` | Read cached eligibility. `?refresh=true` forces revalidation and clears the workspace skill cache. |
| `POST` | `/api/workspaces/:id/endev/revalidate` | Force revalidation and clear the workspace skill cache. |

## Skill Surfacing

The `EnDev-xDpu` wrapper skill and auto-discovered EnDev plugin skill folders are surfaced **only** in eligible workspaces — otherwise hidden from skill lists, pickers, and recents. Disabling the wrapper goes through the standard `disabledSkills` mechanism; the subsystem has no dedicated per-repo toggle. EnDev MCP servers and EnDev plugin skills follow their own settings independently of the wrapper skill.
