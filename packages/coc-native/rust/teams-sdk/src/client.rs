use crate::{
    auth::TokenProvider,
    capabilities::Routes,
    http::{HttpTransport, ReqwestTransport},
    Account, Result, Session,
};
use std::sync::Arc;

pub struct TeamsClient {
    pub(crate) config: Arc<Config>,
}
pub(crate) struct Config {
    pub tokens: Arc<dyn TokenProvider>,
    pub http: Arc<dyn HttpTransport>,
    pub routes: Routes,
    pub region: Option<crate::ic3::Region>,
    pub verifier: Option<Arc<dyn crate::ic3::ChatVerifier>>,
}
pub struct TeamsClientBuilder {
    tokens: Arc<dyn TokenProvider>,
    http: Option<Arc<dyn HttpTransport>>,
    routes: Routes,
    region: Option<crate::ic3::Region>,
    verifier: Option<Arc<dyn crate::ic3::ChatVerifier>>,
}
impl TeamsClient {
    pub fn builder(tokens: Arc<dyn TokenProvider>) -> TeamsClientBuilder {
        TeamsClientBuilder {
            tokens,
            http: None,
            routes: Routes::default(),
            region: None,
            verifier: None,
        }
    }
    pub fn session(&self, account: Account) -> Session {
        Session::new(self.config.clone(), account)
    }
    /// Revokes all clones of the old session before returning the new account binding.
    pub fn reconnect(&self, old: &Session, account: Account) -> Session {
        old.close();
        self.session(account)
    }
}
impl TeamsClientBuilder {
    pub fn routes(mut self, routes: Routes) -> Self {
        self.routes = routes;
        self
    }
    /// Explicit trusted transport injection, not a production URL override.
    pub fn transport(mut self, http: Arc<dyn HttpTransport>) -> Self {
        self.http = Some(http);
        self
    }
    pub fn ic3_region(mut self, region: crate::ic3::Region) -> Self {
        self.region = Some(region);
        self
    }
    pub fn ic3_verifier(mut self, verifier: Arc<dyn crate::ic3::ChatVerifier>) -> Self {
        self.verifier = Some(verifier);
        self
    }
    pub fn build(self) -> Result<TeamsClient> {
        Ok(TeamsClient {
            config: Arc::new(Config {
                tokens: self.tokens,
                http: match self.http {
                    Some(http) => http,
                    None => Arc::new(ReqwestTransport::new()?),
                },
                routes: self.routes,
                region: self.region,
                verifier: self.verifier,
            }),
        })
    }
}
