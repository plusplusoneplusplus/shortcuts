# One CoC per tenant — reference deployment

Reference manifests for running the CoC image as a **managed service, one CoC
instance per tenant**. The image (`ghcr.io/plusplusoneplusplus/coc`) is the
tenant unit; a control plane stamps these files out per tenant. The control
plane itself (tenant registry, provisioner, IdP integration, upgrades, billing)
is out of scope here — this directory is the image's *contract* with it.

Files:

| File | What |
|---|---|
| `tenant.yaml` | Kubernetes: Namespace, PVCs (`/data`, `/work`), Secret, ConfigMap, Deployment (`coc` + `auth-proxy` sidecar), Service, Ingress, NetworkPolicy |
| `docker-compose.tenant.yml` | Plain-Docker equivalent: `coc` + `auth-proxy` sharing one network namespace |

## The pattern

```
[ingress: t-<id>.coc.example.com] ──TLS──▶ ┌─ pod / shared netns for tenant ───────────┐
                                           │ auth-proxy sidecar  (binds pod IP:8080)   │
                                           │      │ OIDC/session check, user ∈ tenant   │
                                           │      ▼ http://127.0.0.1:4000               │
                                           │ coc  (this image, --host 127.0.0.1)        │
                                           │      /data  ← per-tenant PVC (~/.coc)      │
                                           │      /work  ← tenant repos, cloned inside  │
                                           └────────────────────────────────────────────┘
```

**Why loopback + a same-netns sidecar.** The CoC server binds `127.0.0.1` inside
the container — never `0.0.0.0` — exactly like `coc serve` on a laptop. A
loopback-bound process is unreachable from any other network namespace, so the
*only* way in is a process sharing the namespace: the auth sidecar. There is no
configuration in which the CoC process is exposed without auth, no `-p`, no
`EXPOSE`, no `Service` pointing at 4000. Kubernetes gives you the shared
namespace for free (containers in a pod); in Docker Compose it is
`network_mode: "service:<owner>"`.

> Docker Compose only lets the *owner* of a shared namespace publish ports, so
> in `docker-compose.tenant.yml` the proxy owns the namespace and `coc` joins
> it. Only `8080` is published, and only on the host loopback for a host
> reverse proxy to pick up. In the k8s pod the two containers are peers.

**One hostname per tenant.** `coc serve` has no base-path support (the SPA
assumes root), so routing is `t-<id>.<wildcard>` → that tenant's sidecar. The
sidecar must not set `X-Forwarded-Prefix`, must pass WebSockets (terminal,
live updates) and SSE (chat streams) through, and needs idle/read timeouts
disabled or very long.

**Tenant == one trust domain.** CoC has no user model: everyone who gets past
the sidecar sees everything in that instance (all chats, repos, terminals,
agent credentials). Membership is an IdP group/claim per tenant. More separate
users ⇒ more tenants, not more accounts in one tenant.

**Per-tenant agent auth.** Either the provisioner writes tokens into the
per-tenant Secret (`COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY` — passed straight through to the process), or the tenant runs
the device-flow login (`copilot` → `/login`, `gh auth login`, …) in the in-app
terminal once; that state lands under `/data` (`HOME=/data`) and persists.

## Image contract

- Runs as uid/gid `1000` (`node`); `fsGroup: 1000` on the PVCs.
- `HOME=/data`; data dir `/data/.coc` (`config.yaml`, `processes.db`, `skills/`,
  `logs/`); repos under `/work`.
- Loopback bind is fixed policy — the `args` keep `--host 127.0.0.1`.
- Health: `GET http://127.0.0.1:4000/api/health`. Kubernetes `httpGet` probes hit
  the pod IP, which loopback does not answer — the manifests use `exec` with
  the same `node -e "fetch(...)"` as the image `HEALTHCHECK`.
- Graceful drain: SIGTERM → `tini` → `coc serve` drains the queue (running
  tasks finish) before exiting 0. Set `terminationGracePeriodSeconds` /
  `stop_grace_period` ≥ the drain timeout you configure (`--drain-timeout`).
- Single replica, `strategy: Recreate`, RWO storage — SQLite.
- `readOnlyRootFilesystem: false` for now (agents write to `/work`, `/tmp`;
  nothing writes under `/app`).
- First-boot seeding via env (all optional, idempotent; see
  `docker/entrypoint.sh`): `COC_INIT_CONFIG`, `COC_INIT_REPOS`,
  `COC_INIT_SKILLS_DIR`, `GIT_AUTHOR_NAME`/`GIT_AUTHOR_EMAIL`. Repos are cloned
  into `/work/<name>` and registered as workspaces through the loopback REST
  API once the server is healthy; a failed clone never blocks the server.
- `coc` CLI is on `PATH` inside the container for provisioner `exec` hooks
  (`kubectl exec … -c coc -- coc queue …`).

## Lifecycle

- **Provision:** create Namespace/PVCs/Secret/ConfigMap → apply Deployment →
  wait for readiness → apply Service/Ingress (route only once healthy).
- **Upgrade:** bump `IMAGE_TAG` (pin tenants to `X.Y.Z`, canary a few first) →
  `Recreate` sends SIGTERM → drain → new pod on the same PVC.
- **Delete:** scale to 0 (drain) → snapshot the `/data` PVC → destroy the
  namespace.
- **Idle:** scaling to 0 is safe (nothing runs while stopped — cron/sync
  schedules simply don't fire).

## Isolation checklist — treat each tenant container as hostile

An autopilot agent inside CoC executes arbitrary commands with the tenant's
credentials. Assume it can be steered.

- [ ] Non-root, no privilege escalation, all capabilities dropped, seccomp
      `RuntimeDefault`; consider `runtimeClassName: gvisor` / Kata.
- [ ] Ingress only from the ingress controller to the sidecar's `8080`.
- [ ] Egress allowlist (IdP, `github.com`/`api.github.com`, `api.openai.com`,
      `api.anthropic.com`, `registry.npmjs.org`, DNS). Block RFC1918 and the
      cloud metadata endpoint. Prefer an egress gateway over CIDR guesses.
- [ ] No cluster credentials in the pod (`automountServiceAccountToken: false`
      is a good addition), no shared volumes across tenants.
- [ ] Resource requests/limits so one tenant can't starve neighbours.
- [ ] Per-tenant secrets, rotated by the control plane; never a shared token.
- [ ] Log shipping of `/data/.coc/logs/*.ndjson` and volume snapshots for
      backup, per tenant.
