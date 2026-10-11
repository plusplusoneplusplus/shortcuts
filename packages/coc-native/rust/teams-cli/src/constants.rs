pub(crate) const TENANT_ID_ENV: &str = "TEAMS_TENANT_ID";
pub(crate) const USER_ID_ENV: &str = "TEAMS_USER_ID";
pub(crate) const GRAPH_TOKEN_ENV: &str = "TEAMS_GRAPH_TOKEN";
pub(crate) const GRAPH_TOKEN_EXPIRY_ENV: &str = "TEAMS_GRAPH_TOKEN_EXPIRES_AT";
pub(crate) const IC3_TOKEN_ENV: &str = "TEAMS_IC3_TOKEN";
pub(crate) const IC3_TOKEN_EXPIRY_ENV: &str = "TEAMS_IC3_TOKEN_EXPIRES_AT";

pub(crate) const AUTH_HELP: &str = "\
Reads the first page (up to 50 chats or messages).
watch verifies IC3 notification registration and prints body-free change hints.
--backend graph|ic3 selects the backend (default: ic3; no fallback).
--region amer|emea|apac selects the IC3 region (default: amer); invalid for Graph.
Use --tenant-id to override TEAMS_TENANT_ID (before or after the command).
Tenant priority: --tenant-id, TEAMS_TENANT_ID, then Azure CLI's active tenant.
Without an explicit backend token, auth-sdk pins Azure CLI's active user/tenant/subscription.
TEAMS_USER_ID, if set, must match the verified signed-in user's object ID (not CLI user.name).
If TEAMS_GRAPH_TOKEN is absent, acquire Graph credentials through auth-sdk.
Graph uses TEAMS_GRAPH_TOKEN with TEAMS_GRAPH_TOKEN_EXPIRES_AT (Unix seconds).
IC3 uses TEAMS_IC3_TOKEN and TEAMS_IC3_TOKEN_EXPIRES_AT (Unix seconds), or
auth-sdk Azure CLI with resource https://ic3.teams.office.com if the token is absent.
IC3 is experimental; Azure CLI may not be authorized to obtain its token.
Azure CLI's active tenant must match the selected tenant.
Explicit tokens require a tenant ID, TEAMS_USER_ID and their matching expiry.
Invalid explicit credentials fail without trying Azure CLI.
Tokens must be delegated and issued for this account and the selected resource.
Graph requires Chat.Read permission. Azure CLI tokens may need additional consent.
Azure CLI credentials renew on demand and once after a read HTTP 401; no source fallback.
Explicit tokens cannot refresh. This CLI never logs in or changes the active CLI account.
Ctrl+C cancels authentication and Teams work.
Message text is displayed on stdout; do not redirect it to shared logs.";
