# auth-sdk

Standalone, unpublished Rust library in the native Cargo workspace. It has no
Node dependency or application policy. `auth_sdk::microsoft` implements Microsoft
public-cloud, US-government and China-cloud OAuth, plus Azure CLI acquisition.
`auth_sdk::github` reads existing, explicitly selected Copilot CLI and GitHub CLI credentials.
Shared `Account`, `Token`, `Secret`, `Clock`, `CredentialStore`, lifecycle and
`AuthError` contracts are vendor-neutral. Future vendors use separate modules,
not a universal vendor options object.

The N-API addon exports `MicrosoftTokenProvider` and `MicrosoftOAuthSignIn` through
the native package. Nothing automatically instantiates them. Existing consumers,
Microsoft handles have their own lifecycle; GitHub acquisition uses one-shot
`readGitHubCredential` requests through the native package.

## GitHub CLI credential acquisition

`GitHubCredentialOptions` selects `CopilotCliConfig { config_path, account }` or
`GhCli { account }`, with a positive `timeout_ms` of at most 10,000.
`CopilotAccountSelection` is `ActiveCliAccount` or `Explicit(GitHubAccount)`.
The host resolves the config path, including `COPILOT_HOME`, before calling Rust.
Every call rereads selection and credentials. CLI metadata selects an account;
it is not network-verified identity. The snapshot contains only an account and
`Secret` token, without expiry, refresh, login, storage writes or token exchange.

Config reads accept full-line JSONC comments, cap bytes at 1 MiB and reject
non-object JSON, invalid selection and changes between two bounded reads of
the same handle or its metadata snapshots. Byte comparison detects same-size
rewrites even when timestamps coincide, without blocking external writers.
Bare or HTTPS hosts retain their exact spelling for `host:login` lookup;
only returned hostnames are lowercased. Host credentials, ports, paths other than
the HTTPS root slash, queries and fragments are rejected.

File lookup checks `authTokens[host:login:github].token`, then
`authTokens[host:login].token`, then `copilotTokens[host:login]`, skipping
absent/null/empty tokens. Malformed token maps or selected auth entries fail.
Only an absent, null or empty file token permits OS lookup for
the selected account: Windows generic target `copilot-cli/<stored-host>:<login>`
or macOS Keychain service `copilot-cli`, account `<stored-host>:<login>`.
Linux config acquisition is file-only and reports `StorageUnavailable` when
the selected token is absent. Non-string file tokens fail. Nonempty strings
return to the consumer for its service-specific token policy; they never
trigger OS lookup or another source.

GitHub CLI executes `gh auth token --hostname <host> --user <login>`, removing
`GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN`
from only the child environment. macOS lookup executes `/usr/bin/security`.
Both commands cap stdout and stderr at 16 KiB and share the request deadline.
The shared process runner starts Windows children suspended in kill-on-close
jobs and Unix children in process groups. Cancellation and timeout drop the
tree and let Tokio reap the child. Config and Windows reads run on blocking
workers with cancellation/deadline checks before publication. Synchronous OS
reads cannot be preempted; a cancelled worker may finish but cannot return a
credential to the caller.

`readGitHubCredential(options, signal?)` returns an immutable `{token,host,login}`
snapshot and creates a separate native cancellation handle per call. Missing
binary capabilities and sanitized `AuthError` codes propagate without a JS
reader fallback. Environment/custom JS resolvers and Copilot SDK RPC stay in
TypeScript, as do Copilot API authorization and allowed token-family checks.
JavaScript token strings cannot be zeroized.

## Source selection

Rust `ProviderOptions` requires `MicrosoftTokenSource` and `Refresh`.
The TypeScript constructor requires this discriminated union:

```ts
new MicrosoftTokenProvider({
    source: 'oauth',
    refresh: 'auto',
    account: { id: '<verified-object-id>', tenant: '<tenant-id>' },
    oauth: {
        namespace: '<workspace-namespace>',
        authority: 'https://login.microsoftonline.com/<tenant-id>',
        clientId: '<registered-client-id>',
        scopes: ['openid', 'profile', 'offline_access', '<resource-scope>'],
        target: '<requested-target>',
        coordinationDirectory: '<absolute-private-local-directory>',
    },
});

new MicrosoftTokenProvider({
    source: 'azure-cli',
    refresh: 'never',
    azureCli: {
        namespace: '<workspace-namespace>',
        account: { id: '<exact-cli-user-name>', tenant: '<tenant-id>' },
        subscription: '<subscription-id>',
        resource: '<resource-uri-or-id>',
    },
});

new MicrosoftTokenProvider({
    source: 'azure-cli',
    refresh: 'auto',
    azureCli: {
        selection: 'active-account',
        namespace: '<workspace-namespace>',
        resource: '<resource-uri-or-id>',
    },
});
```

Construction validates only: no credential access, CLI execution, HTTP, callback
listener, directory creation or browser launch. There are no inferred sources,
client IDs, targets, ambient tokens, other-account attempts or source fallbacks.
OAuth requires an explicit tenant UUID and a matching verified object UUID.
Bootstrap sign-in may omit the expected account, but not the tenant/client/scopes.
Scopes include `openid`, `profile` and `offline_access`. Microsoft requires
`profile` for the object-ID claim used to verify account identity.
`resource` is optional and sent only
when explicitly configured for a protocol that requires it.

Azure CLI accepts either an explicit account/tenant/subscription or the explicit
`selection: 'active-account'` mode (`AzureCliOptions.selection` in Rust).
Rust uses `AzureCliSelection::ActiveAccount` or
`AzureCliSelection::Explicit { account, subscription }` within the single Azure CLI source.
Active mode reads `az account show` on first token use, pins that user/tenant/subscription
for the provider lifetime, and checks the active selection before returning cached
tokens and after acquisition. Selection changes return `AccountMismatch`; they never
select a replacement identity within the provider. Active providers have isolated
token caches. Partial explicit identity settings are invalid.

The adapter checks the pinned subscription's exact
`user.name`/tenant before and after resource-specific `account get-access-token`,
passes `--subscription` (Azure CLI rejects combining it with `--tenant`),
verifies the selected subscription's tenant, and checks the token response's
subscription/tenant. Unsupported or ambiguous selection fails; it never changes
CLI state, calls `az login`, or persists CLI refresh credentials. It requires
modern `az` output with UTC `expires_on`; ambiguous local `expiresOn` is rejected.
Windows resolves `az.cmd` from the process `PATH`, then the standard Azure CLI
installation under `ProgramW6432`, `ProgramFiles` or `ProgramFiles(x86)`.
This supports long-lived hosts with a stale `PATH`; a selected executable's
failure never retries another installation. Windows launches it with validated
arguments, suspended inside a kill-on-close job; Unix uses `az` from `PATH` and a
process group. Dropped operations kill the tree and Tokio reaps the direct child.
Raw CLI output never enters diagnostics.

## Token lifecycle

Rust `exchange_refresh_token(http, options, refresh, cancel, deadline)` exchanges a
caller-owned `Secret` without credential-store access or account metadata.
`OAuthRefreshOptions` validates a supported Microsoft HTTPS login origin, tenant
UUID or `common`/`organizations`/`consumers`, client UUID, scopes and optional
resource. It posts directly to the authority's v2 token endpoint using the shared
transport, zeroized form and response parser. Callers prepare scopes (including
`offline_access` and any `.default` normalization) and own scheduling, cache
updates, credential coordination and persistence.

`OAuthRefreshResponse` reports secret-wrapped access, optional rotated refresh
and unverified ID tokens, token type, relative expiry and optional reported scope.
Missing rotation and scope stay absent; callers retain prior values as needed.
`OAuthRefreshError` carries the existing sanitized `AuthError`, optional HTTP
status and only the allow-listed `InvalidGrant`, `InteractionRequired` or
`ConsentRequired` rejection. Unknown provider strings and descriptions are
discarded. Cache callers can keep 5xx failures transient using the status.
Native acquisition maps errors to the existing codes, retains trusted discovery,
verifies returned identity and persists rotation under its credential lock.
The native package exports
`exchangeMicrosoftRefreshToken(options, refreshToken, signal?)`. Options contain
`authority`, `clientId`, `scopes`, optional `resource` and optional `timeoutMs`
(default 30,000; range 100..900,000 ms). It returns an immutable
`{ accessToken, tokenType, expiresIn, scope?, refreshToken? }`, with relative expiry
in seconds and only reported scope/rotation. Unverified ID tokens stay in Rust.
Each call owns a one-shot native cancellation handle; abort/timeout drops HTTP work
and prevents late publication, including after dispatch or Node delivery delays.
`MicrosoftOAuthRefreshError` extends `AuthError` with optional `status` and
`rejection` (`invalid_grant`, `interaction_required`, `consent_required`).
Only the exact rejection supports cache invalidation, not the broader SDK code;
status still informs transient-failure policy. No raw error is retained as cause.
The Node background refresher retains its separate HTTP, timer and cache behavior.

`expiryMarginSeconds` defaults to 60. A token is usable only when
`expiresAt > now + margin`; equality requires renewal. Provider `timeoutMs`
defaults to 30,000; sign-in defaults to 300,000. Configured timeouts range from
100 to 900,000 ms, and margins from zero to 3,600 seconds.

| State / action | `auto` | `never` |
|---|---|---|
| No successfully acquired token | Noninteractive acquisition | Noninteractive acquisition |
| Failed/cancelled initial attempt | Retry allowed | Retry allowed |
| Valid cached token above margin | Return cached token | Return cached token |
| Acquired token at/below margin | Acquire/refresh on demand | `RefreshDisabled` |
| `getToken({ forceRefresh: true })` | Explicit acquisition/refresh | `RefreshDisabled`, including before first acquisition |
| `invalidate()` after success | Clear instance/shared reusable cache | Clear cache, retain irreversible acquired state |
| `deleteCredentials()` | Delete exact OAuth credential and invalidate | Delete and invalidate, retain acquired state |
| `dispose()` | Cancel work; reject further calls | Cancel work; reject further calls |

An initial provider OAuth refresh grant from this SDK's stored verified credential
counts as noninteractive acquisition. `never` means no renewal of this provider's
successfully acquired token, not prohibition of that initial grant.
Invalidation is not a reset or sign-out. A new provider is a new lifecycle.
Deletion does not revoke a server-side grant and does not purge another live
provider's instance access token. Azure CLI credential deletion is unsupported.
The SDK provider renews on demand; caller-owned background scheduling stays outside it.

Concurrent matching operations share results, including failures and forced
renewal. Keys isolate source, namespace, authority, client, account/tenant,
target/resource, normalized scopes and storage coordination domain. Injectable
Rust dependencies also isolate their trust domains. Cancelling a waiting
provider does not cancel a different provider's acquisition. A cancelled leader
drops its work; surviving waiters may start a replacement operation.

Returned tokens contain `accessToken`, `tokenType`, Unix-millisecond `expiresAt`,
`source`, requested `target`, trusted `account`, and `grantedScopes` only when
reported by the OAuth token endpoint. Requested scopes are not granted scopes.
Access tokens may be opaque and are never decoded as authentication evidence.

## Explicit OAuth sign-in

Construct `MicrosoftOAuthSignIn(oauthOptions, expectedAccount?, timeoutMs?)`.
Call `beginBrowser()` or `beginDevice()` once, display the returned instructions,
then call `wait()`. The SDK never opens the browser. Rust exposes the corresponding
`begin_browser`, `begin_device`, `wait`, `cancel` and `dispose` methods.

Browser flow binds only `127.0.0.1` on an ephemeral port and returns an authorization
URL with redirect `http://localhost:<port>/`. Authorization and token exchange
use the same localhost root redirect; the listener stays bound to the IPv4
loopback address. The registered client must allow this redirect; the SDK does
not retry another host or path. The callback
accepts only the exact root path `/`, checks state and duplicate parameters,
exchanges the code with its PKCE verifier, and
requires the ID-token nonce. Device polling honors pending/slow-down responses,
denial, expiry and the handle deadline. Both flows verify RS256 signatures against
trusted discovery/JWKS, issuer, audience, expiry/not-before, tenant and object ID.
An expected-account mismatch fails before credential storage.

`wait()` returns an account descriptor for a pinned provider only after refresh
credentials are securely persisted. The sign-in handle is one-shot; failure
requires a new handle. Its deadline closes a waiting callback listener even when
the caller never invokes `wait()`. Cancellation/disposal closes listeners and
drops network/polling work. Token access returns `InteractionRequired` when
credentials/login/consent are needed; it never starts interactive sign-in.

## Storage and security boundaries

Refresh credentials use exact `auth-sdk:v1:<digest>` keys: Windows Credential
Manager, non-synchronizing macOS Keychain, and Linux Secret Service with encrypted
DBus sessions. There is no plaintext or Linux keyutils fallback. Linux/macOS
storage queries reject locked/denied stores without opening an unlock prompt.
Windows stores UTF-8 secret blobs rather than UTF-16 passwords; its 2,560-byte
credential limit applies to the complete encoded refresh credential.
Unavailable, locked, denied and failed operations have explicit typed errors.
No unrelated account enumeration, consumer-cache import or access-token persistence
is performed. Secret-bearing Rust types have neither `Debug` nor `Serialize`.

The caller supplies an existing private, local coordination directory. Unix
permissions must exclude group/other access; Windows callers must provision a
private ACL. The directory's configured identity participates in credential keys,
so different directories cannot race on one stored entry. Use one stable spelling
across processes to share credentials. SDK lock files contain no secrets; never
remove them while a process may be using the namespace. OS advisory locks span
credential read, refresh exchange and durable rotation; contention is bounded by
the operation timeout. OS secret stores are not CAS. External writers that ignore
these SDK locks are outside this coordination contract.

Cancellation/disposal and durable publication are serialized. Deadlines are
checked before committing and returning success; dropped async work cannot later
publish a result. **An OS credential transaction already in progress is synchronous
and non-preemptible.** Disposal waits for that transaction, and a backend/kernel
stall can extend the configured timeout. Custom synchronous `CredentialStore`
implementations must also bound their own calls. There is no detached storage
worker that writes credentials after cancellation. Cancellation during a remotely
rotating refresh exchange can require explicit sign-in if the remote server
invalidates the previous credential before the response is received.

HTTPS discovery and token requests are bounded, have capped bodies, and reject
redirects. Provider and sign-in authorities require supported Microsoft login
origins and tenant-specific paths. Discovery cannot substitute token/authorization
origins or untrusted JWKS URLs. SDK diagnostics contain only defined codes,
allow-listed refresh rejections and HTTP status, never provider descriptions,
raw output, secrets or account identifiers. Rust secret buffers and owned form
values are zeroized on drop where feasible. HTTP-library buffers and JavaScript
strings cannot guarantee erasure; callers must not log or persist returned tokens.

## Registration and service access

An existing caller-owned public-client registration, appropriate redirect/device
flow configuration, resource scopes, tenant policy and consent are required.
The SDK does not create app registrations or promise that any registration can
access Teams MCP, Graph, IC3, Azure DevOps or Kusto. Configure each requested
resource separately and handle service authorization independently. Private
service access and audience-specific permissions remain service constraints.

## Validation

Run `cargo test --locked -p auth-sdk` from the native Rust workspace, without Node.
Tests use fake clocks, OAuth discovery/JWKS and synthetic identity signing keys,
isolated memory stores, fake CLI runners/executables and competing lock processes.
The ignored `isolated_os_store_fixture` tests write/delete only unique SDK entries;
CI runs them explicitly, including Windows UTF-8 storage-limit checks.
Linux unavailable-store tests use a separate process with
an invalid DBus address. Native CI tests Linux/macOS/Windows; release tests cover
the six packaged targets. Cargo audits use the shared lockfile.

`npm run build:native -w packages/coc-native` generates the committed bindings.
`npm run build -w packages/coc-native` checks TypeScript, and
`npm run test:run -w packages/coc-native -- test/auth.test.ts` exercises the built
addon, typed errors, cancellation/disposal and missing-capability failures without
real user authentication.
`test/github-auth.test.ts` covers the GitHub addon with synthetic executables and
config fixtures. Rust Windows tests create and remove unique generic credentials;
the ignored `github::tests::isolated_macos_cli_keychain_fixture` checks exact
same-account CLI Keychain import on macOS with scoped cleanup.
`cargo test --locked -p coc-native auth::refresh::tests` uses trusted Rust
HTTP injection for boundary conversion, safe errors, one-shot handles and
cancelled/timed-out work cleanup. `test/oauth-refresh.test.ts` covers built-addon
validation and trusted loader fixtures for the exported TypeScript wrapper.
Refresh tests make no auth network requests or credential-store accesses.
