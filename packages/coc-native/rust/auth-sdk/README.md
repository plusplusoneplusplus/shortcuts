# auth-sdk

Standalone, unpublished Rust library in the native Cargo workspace. It has no
Node dependency or application policy. `auth_sdk::microsoft` implements Microsoft
public-cloud, US-government and China-cloud OAuth, plus Azure CLI acquisition.
Shared `Account`, `Token`, `Secret`, `Clock`, `CredentialStore`, lifecycle and
`AuthError` contracts are vendor-neutral. Future vendors use separate modules,
not a universal vendor options object.

The N-API addon exports `MicrosoftTokenProvider` and `MicrosoftOAuthSignIn` through
the native package. Nothing automatically instantiates them. Existing consumers,
credential files and Copilot's read-only Windows credential capability are separate.

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
        scopes: ['openid', 'offline_access', '<resource-scope>'],
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
Scopes include `openid` and `offline_access`; `resource` is optional and sent only
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
Windows launches `az.cmd` with validated arguments and starts it suspended inside
a kill-on-close job; Unix uses a process group. Dropped operations kill the tree
and Tokio reaps the direct child. Raw CLI output never enters diagnostics.

## Token lifecycle

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

An initial OAuth refresh grant from this SDK's stored verified credential counts
as noninteractive acquisition. `never` means no renewal of this provider's
successfully acquired token, not prohibition of that initial grant.
Invalidation is not a reset or sign-out. A new provider is a new lifecycle.
Deletion does not revoke a server-side grant and does not purge another live
provider's instance access token. Azure CLI credential deletion is unsupported.
There is no background token-refresh timer.

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
URL. The registered client must allow this loopback redirect. The callback checks
state and duplicate parameters, exchanges the code with its PKCE verifier, and
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
redirects. Authorities are restricted to supported Microsoft login origins and
tenant-specific paths. Discovery cannot substitute token/authorization origins or
untrusted JWKS URLs. SDK errors contain codes only, never provider descriptions,
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
The ignored `isolated_os_store_fixture` test writes/deletes only a unique SDK entry;
CI runs it explicitly. Linux unavailable-store tests use a separate process with
an invalid DBus address. Native CI tests Linux/macOS/Windows; release tests cover
the six packaged targets. Cargo audits use the shared lockfile.

`npm run build:native -w packages/coc-native` generates the committed bindings.
`npm run build -w packages/coc-native` checks TypeScript, and
`npm run test:run -w packages/coc-native -- test/auth.test.ts` exercises the built
addon, typed errors, cancellation/disposal and missing-capability failures without
real user authentication.
