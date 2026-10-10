# CoC provider authentication

This document covers the Claude, Codex, and GitHub Copilot providers. Authentication runs on the machine hosting CoC, under the operating-system user running the server. Signing into a browser on another machine does not by itself provide credentials to the CoC server.

## Overview

| Provider | Subscription login | Credential storage | Account selection mechanism | Current CoC behavior |
| --- | --- | --- | --- | --- |
| Claude | Claude Code browser login | Linux/Windows: `.credentials.json`; macOS: Keychain | `CLAUDE_CONFIG_DIR` in the SDK child's environment | Chats inherit the server environment; no per-chat account selector |
| Codex | `codex login` with ChatGPT | `$CODEX_HOME/auth.json` or OS credential store | `CODEX_HOME` in the SDK client's environment | Chats and quota processes inherit the server environment; no per-chat account selector |
| GitHub Copilot | `copilot login` with GitHub | OS keychain, with an optional plaintext config fallback | SDK `gitHubToken` or `gitHubTokenProvider`, including session options | Chats use ambient CLI authentication; no per-chat account selector |

Subscription authentication does not require a model API key. The SDKs delegate normal credential handling to their provider runtimes. CoC separately reads Claude OAuth credentials for quota reporting.

## Claude

### Login and storage

Run `claude` and sign in with the subscribed Claude account. For separate accounts, launch the CLI with a separate configuration directory and complete login for each:

```bash
CLAUDE_CONFIG_DIR="$HOME/.claude-personal" claude
CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude
```

On Linux and Windows, credentials live in `<config-directory>/.credentials.json`; the default directory is `~/.claude`. On macOS, Claude uses Keychain, with the configuration directory identifying the credential entry. macOS can fall back to the credentials file when Keychain writes fail.

The SDK launches Claude Code, which reads the selected account's credentials and manages refresh. CoC need not copy the token into each chat request. A login that cannot be refreshed requires another sign-in.

### Per-session accounts

The SDK supports a separate environment for each `query()` call:

```ts
query({
  prompt,
  options: {
    env: { ...process.env, CLAUDE_CONFIG_DIR: accountConfigDirectory },
  },
});
```

The TypeScript SDK replaces the child environment when `env` is supplied, so preserve required inherited variables. Credentials such as `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and `CLAUDE_CODE_OAUTH_TOKEN` can override the saved subscription login. Account routing must handle these overrides explicitly rather than blindly retaining them.

CoC's Claude adapter does not pass a per-chat account environment. Setting `CLAUDE_CONFIG_DIR` when starting the server selects the inherited directory for Claude chat processes on that server. It does not provide a different account for each chat.

### CoC background quota and credential refresh

The server refreshes its provider quota cache every five minutes. When Claude is enabled, `getAccountQuota()` reads the OAuth credentials and calls `https://api.anthropic.com/api/oauth/usage`.

The quota reader checks these sources:

1. `CLAUDE_CREDENTIALS_FILE`, when set; this source is exclusive.
2. `~/.claude/.credentials.json`.
3. The default macOS Keychain entry.

If the access token expires within 60 seconds, or the usage endpoint returns HTTP 401, CoC attempts a refresh through a promptless SDK session. It calls `accountInfo()`, letting Claude Code refresh and persist the credentials. The probe disables user/project settings with `settingSources: []`, closes afterward, and has a 30-second timeout. Concurrent callers share the probe; probes are at least five minutes apart.

CoC rereads the credentials and retries the usage lookup when the token changed. It does not call the OAuth token endpoint or write refreshed credentials itself. When OAuth quota lookup fails, it falls back to available cached rate-limit or account-info data.

The quota reader does not resolve `CLAUDE_CONFIG_DIR`. The refresh probe inherits the server environment. A custom directory can therefore make chat authentication and quota credential lookup refer to different accounts. `CLAUDE_CREDENTIALS_FILE` selects only the quota reader's file; it does not configure the SDK login directory.

## Codex

### Login and storage

Run `codex login` on the CoC host and sign in with ChatGPT. Codex stores credentials according to `cli_auth_credentials_store`:

| Setting | Storage |
| --- | --- |
| `file` | `$CODEX_HOME/auth.json`, defaulting to `~/.codex/auth.json` |
| `keyring` | OS credential store; fails when unavailable |
| `auto` | OS credential store when available, otherwise the file |
| `ephemeral` | Current process memory only |

The SDK starts the Codex runtime, which uses the saved login. Codex refreshes ChatGPT tokens automatically during use. CoC does not read or rewrite the auth file for normal chat requests, and does not implement its own token refresh flow.

### CoC quota and multiple accounts

For quota checks, CoC starts `codex app-server --listen stdio://` and issues `account/rateLimits/read`. That process handles authentication through Codex's own auth machinery. CoC has no separate promptless credential-refresh probe for Codex.

SDK clients can receive an environment containing a different `CODEX_HOME`. Current CoC does not bind one to each chat; its SDK clients and quota processes inherit the server environment. Separate-account support must route both execution and quota checks to the appropriate account and retain that account choice across follow-ups.

## GitHub Copilot

### Login and storage

Run `copilot login` and complete GitHub browser or device-code authorization. The SDK uses the stored GitHub OAuth credentials by default.

| Platform | Default credential backend |
| --- | --- |
| Linux | libsecret, backed by GNOME Keyring or KWallet |
| macOS | Keychain Access |
| Windows | Credential Manager |

The keychain service name is `copilot-cli`. When the keychain is unavailable, the CLI can ask to save the token in plaintext at `~/.copilot/config.json`. The field name depends on the CLI configuration format; examples include `copilotTokens` and `copilot_tokens`.

For ambient CLI authentication, token environment variables override the saved login in this order: `COPILOT_GITHUB_TOKEN`, `GH_TOKEN`, then `GITHUB_TOKEN`. GitHub CLI authentication is a fallback when other credentials are unavailable. An explicit SDK token also takes priority over ambient login.

### Explicit accounts and refresh

The SDK accepts a GitHub token at client level:

```ts
const client = new CopilotClient({
  gitHubToken: userAccessToken,
  useLoggedInUser: false,
});
```

It also exposes per-session `gitHubToken` and `gitHubTokenProvider`. For a token provider, the runtime asks the application for the initial token and requests refresh before credential-consuming operations when the token has one hour or less remaining. Idle sessions do not run a background refresh timer. The application supplies a valid replacement token and its remaining lifetime.

Current CoC does not wire these session options to a chat account selector. Normal chats rely on ambient CLI authentication. Its Copilot quota method accepts an optional `gitHubToken`, but the server's normal provider quota cache does not select an account per chat.

## Requirements for multiple accounts in CoC

Each chat needs a saved account binding, reused on follow-ups and resumes. Credentials should be selected for the individual child process or SDK session, without changing global `process.env`. Quota results and refresh coordination need account-specific keys. Any reusable client must also be isolated by account identity. Workspace routing must remain compatible with multiple repositories and remote CoC servers.

## Sources

- [Claude authentication and credential management](https://code.claude.com/docs/en/authentication)
- [Claude SDK environment configuration](https://code.claude.com/docs/en/agent-sdk/configuration#set-environment-variables)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [GitHub Copilot CLI authentication and storage](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli)
- [GitHub Copilot SDK authentication](https://docs.github.com/en/copilot/how-tos/copilot-sdk/auth/authenticate)
- CoC implementation: `packages/coc-agent-sdk/src/claude-sdk-service.ts`, `codex-sdk-service.ts`, `copilot-sdk-service.ts`, `sdk-client-factory.ts`, and `packages/coc/src/server/agent-providers/quota-cache.ts`.
