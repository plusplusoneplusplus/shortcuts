use crate::{
    constants::{GRAPH_RESOURCE, IC3_RESOURCE, MCP_ORIGIN, MCP_SERVER},
    Account, Error, ErrorCode, Result,
};
use async_trait::async_trait;
use std::time::{Duration, SystemTime};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Audience {
    Graph,
    TeamsMcp,
    Ic3,
}
impl Audience {
    /// OAuth resource identifier; consent/scopes and token validation belong to the provider.
    pub fn resource(self, account: &Account) -> String {
        match self {
            Self::Graph => GRAPH_RESOURCE.into(),
            Self::Ic3 => IC3_RESOURCE.into(),
            Self::TeamsMcp => {
                let mut url = url::Url::parse(MCP_ORIGIN).expect("static origin");
                url.path_segments_mut()
                    .expect("hierarchical origin")
                    .extend([
                        "agents",
                        "tenants",
                        account.tenant.as_str(),
                        "servers",
                        MCP_SERVER,
                    ]);
                url.into()
            }
        }
    }
}

/// Trusted credential metadata. The provider must verify account/audience claims using
/// its authentication authority; parsing a JWT alone is not signature validation.
pub struct AccessToken {
    pub account: Account,
    pub audience: Audience,
    pub expires_at: SystemTime,
    pub secret: String,
}
impl AccessToken {
    pub(crate) fn validate(&self, account: &Account, audience: Audience) -> Result<()> {
        if !self.account.matches(account)
            || self.audience != audience
            || self.secret.is_empty()
            || self
                .secret
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
            || self
                .expires_at
                .duration_since(SystemTime::now())
                .unwrap_or_default()
                < Duration::from_secs(30)
        {
            return Err(Error::new(ErrorCode::Authentication));
        }
        Ok(())
    }
}
#[async_trait]
pub trait TokenProvider: Send + Sync {
    /// `force_refresh` is set for the one permitted read retry after HTTP 401,
    /// and for notification reconnect/lease renewal.
    /// Futures may be dropped on cancellation; providers must not dispatch Teams writes.
    async fn acquire(
        &self,
        account: &Account,
        audience: Audience,
        force_refresh: bool,
    ) -> Result<AccessToken>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{TenantId, UserId};

    #[test]
    fn resource_constants_preserve_audiences_and_escaped_tenant_paths() {
        let account = Account::new(
            TenantId::new("tenant/segment").unwrap(),
            UserId::new("user").unwrap(),
        );
        assert_eq!(Audience::Graph.resource(&account), GRAPH_RESOURCE);
        assert_eq!(Audience::Ic3.resource(&account), IC3_RESOURCE);
        assert_eq!(
            Audience::TeamsMcp.resource(&account),
            format!("{MCP_ORIGIN}/agents/tenants/tenant%2Fsegment/servers/{MCP_SERVER}")
        );
    }
}
