# auth-cli

Standalone Rust authentication CLI using `auth-sdk`, independent of Node and
CoC runtime consumers. Vendor-specific commands live under `auth-cli microsoft`;
future vendors get separate subcommands, not combined vendor options.

From the native Rust workspace:

```sh
cargo install --locked --path auth-cli
cargo run --locked -p auth-cli -- --help
cargo test --locked -p auth-cli
```

## Quick start: Microsoft

With Azure CLI installed, use its registration and selected account:

```sh
auth-cli microsoft login
auth-cli microsoft token --resource https://graph.microsoft.com
```

`get-access-token` is an alias for `token`. Omit `--resource` for Azure Resource
Manager (`https://management.azure.com/`). Add `--show-secrets` for the full token.
No namespace, client ID, account ID, tenant or subscription flags are needed.
If already signed in with `az login`, skip the login command.

`login` explicitly invokes `az login --output none --only-show-errors`. Azure CLI
owns browser login, registration, consent and its account cache; this command may
change Azure CLI's selected account. Optional `--tenant <tenant-id>` restricts
login. Raw Azure CLI output is not relayed. If your Azure CLI configuration requires
terminal account selection or device-code instructions, use `az login` directly.
The wrapper does not drive interactive terminal prompts or device-code login.

The short token command explicitly selects the Azure CLI source and reads
`az account show`. It pins the returned user, tenant and subscription into the
SDK, which verifies that selection before and after acquisition. It uses `auto`
refresh and a CLI-owned namespace; it never starts login, switches accounts,
tries another account/source or reads OAuth credentials. SDK construction rules
remain strict. Use the source-specific commands below for direct OAuth or manual
identity selection. Resource permissions and tenant consent still apply.

## Secret output

Output is JSON Lines. Secrets show the first eight and last eight **characters**
with `...[redacted]...` between them. Secrets with sixteen or fewer characters
are fully masked to avoid revealing the entire value. Authorization and
verification URL queries/fragments are fully masked because they contain protocol
secrets. Account descriptors, expiry, source and requested target remain visible.
Granted scopes appear only when the SDK knows them.

`--show-secrets` reveals complete output and prints a warning to stderr.
**Use this option to obtain usable browser/device sign-in instructions.**
Without it, sign-in still starts but its URL/code is masked; cancel with Ctrl+C
and rerun with the option to complete sign-in. Direct OAuth sign-in does not open
a browser; `microsoft login` lets Azure CLI own browser login.
Treat displayed device codes and authorization URLs as secrets too.
Do not redirect full output into logs, CI artifacts or shared files.

Only returned access tokens are exposed. The CLI never dumps stored refresh
credentials or imports another application's credentials into the SDK store. The
Azure CLI source obtains access tokens through Azure CLI itself. Output buffers are erased
where practical, but terminal history, pipe consumers and OS buffers cannot be
erased by this program. Even partial token output is sensitive.

## Direct Microsoft OAuth sign-in

Caller-owned client registration, tenant policy and consent are required.
Use an existing private absolute local directory for SDK credential coordination.
On Unix its permissions must exclude group/other access; on Windows provision
a private ACL. Reuse its exact path spelling and namespace across commands.
Refresh credentials go to the OS secret store, never the directory or stdout.

Replace placeholders before running:

```sh
auth-cli --show-secrets microsoft sign-in device \
  --namespace <workspace-namespace> \
  --authority https://login.microsoftonline.com/<tenant-id> \
  --client-id <registered-client-id> \
  --scope openid --scope profile --scope offline_access --scope <resource-scope> \
  --target <requested-target> \
  --coordination-directory <absolute-private-directory>
```

Open the printed `verificationUri` and enter `userCode`. The command polls until
completion, cancellation or timeout. Replace `device` with `browser` to obtain
an authorization-code PKCE URL; open `authorizationUrl` in your browser.
The registration must support the device flow or browser redirect
`http://localhost:<port>/` with an ephemeral port, as appropriate. The browser
callback listener binds only `127.0.0.1`.
Optional `--account-id <verified-object-id>` rejects a different signed-in account.
Bootstrap sign-in omits this option and returns the verified account descriptor.
The final token event is emitted only after durable refresh-credential storage.

`--resource <resource-indicator>` is optional for protocols that require it.
Scopes and resource targets are caller-supplied; the CLI does not assume that one
registration can access Graph, Teams MCP, IC3, ADO or Kusto.

## Noninteractive token acquisition

OAuth token access requires an account pinned to a completed SDK sign-in:

```sh
auth-cli microsoft token oauth \
  --namespace <workspace-namespace> \
  --authority https://login.microsoftonline.com/<tenant-id> \
  --client-id <registered-client-id> \
  --scope openid --scope profile --scope offline_access --scope <resource-scope> \
  --target <requested-target> \
  --coordination-directory <absolute-private-directory> \
  --account-id <verified-object-id> --refresh auto
```

Azure CLI acquisition selects an existing exact account/subscription without
logging in or changing the active account:

```sh
auth-cli microsoft token azure-cli \
  --namespace <workspace-namespace> \
  --account-id <exact-cli-user-name> --tenant-id <tenant-id> \
  --subscription <subscription-id> --resource <resource-uri-or-id> \
  --refresh never
```

Source and `--refresh auto|never` are required for the source-specific commands.
The short `token --resource ...` form uses Azure CLI with `auto`. `--force-refresh` explicitly
requests renewal and is rejected under `never`, including the initial attempt.
Each CLI invocation is a new provider lifetime: `never` still permits its initial
noninteractive acquisition, including an OAuth refresh grant from stored SDK
credentials. Nothing starts interactive sign-in from token access.

`--expiry-margin-seconds` defaults to 60 (0-3600).
`--timeout-ms` defaults to 30000 for tokens and 300000 for login/sign-in (100-900000).
The short token command's deadline includes account discovery and acquisition.
Ctrl+C cancels outstanding work and releases SDK resources; failures have nonzero
exit status and sanitized diagnostics on stderr. OS credential transactions
already in progress remain non-preemptible. See the
[SDK security/lifecycle contracts](../auth-sdk/README.md).

## Distribution and tests

The binary shares the native workspace lockfile, dependency audits and
Linux/macOS/Windows CI gates. Install it separately; it is not included in the
N-API addon, npm package or desktop installer. Tests use synthetic CLI executables
and injected SDK dependencies without real authentication or credential access.
