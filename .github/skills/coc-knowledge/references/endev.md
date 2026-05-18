# EnDev xDPU

Workspace-scoped EnDev xDPU support lives in `packages/coc/src/server/endev/`. The EnDev wrapper skill and EnDev plugin skills are only surfaced in eligible workspaces.

## Eligibility Cache

Eligibility is cached under `~/.coc/repos/<workspaceId>/endev/eligibility.json` and requires **all** of the following:

- A native WSL host
- xDPU workspace markers in the repo
- EnDev setup files present
- A successful short-timeout `endev doctor`

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workspaces/:id/endev/status` | Read cached eligibility. `?refresh=true` forces revalidation and clears the workspace skill cache. |
| `POST` | `/api/workspaces/:id/endev/revalidate` | Force revalidation and clear the workspace skill cache. |

## Skill Surfacing

The `EnDev-xDpu` wrapper skill and auto-discovered EnDev plugin skill folders are surfaced **only** when the workspace is eligible — hidden otherwise from skill lists, pickers, and recents.

There is **no separate per-repo toggle**; users disable the wrapper via the standard `disabledSkills` mechanism if needed.

EnDev MCP servers and EnDev plugin skills follow their own settings independently of the wrapper skill.
