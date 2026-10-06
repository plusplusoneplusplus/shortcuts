pub(crate) const GRAPH_RESOURCE: &str = "https://graph.microsoft.com";
pub(crate) const GRAPH_API_BASE: &str = "https://graph.microsoft.com/v1.0";
pub(crate) const IC3_RESOURCE: &str = "https://ic3.teams.office.com";
pub(crate) const TEAMS_ORIGIN: &str = "https://teams.cloud.microsoft";
pub(crate) const MCP_ORIGIN: &str = "https://agent365.svc.cloud.microsoft";
pub(crate) const MCP_SERVER: &str = "mcp_TeamsServer";

pub(crate) mod ic3 {
    pub(crate) const CHAT_ID_PREFIX: &str = "19:";
    pub(crate) const CHAT_ID_SUFFIX: &str = "@thread.v2";
    pub(crate) const SELF_CHAT_ID: &str = "48:notes";
    pub(crate) const ROSTER_VIEW: &str = "msnp24Equivalent";
    pub(crate) const TROUTER_ENDPOINT: &str = "wss://go.trouter.teams.microsoft.com/v4/c/";
    pub(crate) const REGISTRAR_ENDPOINT: &str =
        "https://teams.cloud.microsoft/registrar/prod/V2/registrations";
    pub(crate) const CLIENT_VERSION: &str = "1415/26043019216";
    pub(crate) const CORRELATION_VERSION: &str = "2026.16.01.1";
    pub(crate) const USER_AGENT: &str = "TeamsCDL";
    pub(crate) const APP_ID: &str = "TeamsCDLWebWorker";
    pub(crate) const TEMPLATE_KEY: &str = "TeamsCDLWebWorker_2.6";
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_resource_constants_preserve_provider_endpoints() {
        assert_eq!(GRAPH_RESOURCE, "https://graph.microsoft.com");
        assert_eq!(IC3_RESOURCE, "https://ic3.teams.office.com");
        assert_eq!(MCP_ORIGIN, "https://agent365.svc.cloud.microsoft");
        assert_eq!(MCP_SERVER, "mcp_TeamsServer");
    }
}
