use super::{config::guid, HttpTransport, OAuthOptions};
use crate::{contracts::fail, Account, AuthError, Clock, ErrorCode, Result};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use url::Url;

pub(crate) struct Metadata {
    pub authorize: String,
    pub token: String,
    pub device: String,
    pub issuer: String,
    pub jwks: String,
}

pub(crate) async fn metadata(http: &dyn HttpTransport, options: &OAuthOptions) -> Result<Metadata> {
    let authority = options.authority();
    let response =
        http.request(&format!("{authority}/v2.0/.well-known/openid-configuration"), None).await?;
    if response.status != 200 {
        return fail(ErrorCode::IdentityVerificationFailed);
    }
    let value: serde_json::Value = serde_json::from_str(response.body.expose())
        .map_err(|_| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
    let expected_issuer = format!("{authority}/v2.0");
    let authorize = format!("{authority}/oauth2/v2.0/authorize");
    let token = format!("{authority}/oauth2/v2.0/token");
    if value["issuer"].as_str() != Some(&expected_issuer)
        || value["authorization_endpoint"].as_str() != Some(&authorize)
        || value["token_endpoint"].as_str() != Some(&token)
    {
        return fail(ErrorCode::IdentityVerificationFailed);
    }
    let jwks = value["jwks_uri"]
        .as_str()
        .ok_or_else(|| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
    let jwks_url =
        Url::parse(jwks).map_err(|_| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
    let base =
        Url::parse(&authority).map_err(|_| AuthError::new(ErrorCode::InvalidConfiguration))?;
    let tenant_keys = format!("/{}/discovery/v2.0/keys", options.tenant());
    if jwks_url.origin() != base.origin()
        || !["/common/discovery/v2.0/keys", &tenant_keys].contains(&jwks_url.path())
        || !jwks_url.username().is_empty()
        || jwks_url.password().is_some()
        || jwks_url.query().is_some()
        || jwks_url.fragment().is_some()
    {
        return fail(ErrorCode::IdentityVerificationFailed);
    }
    Ok(Metadata {
        authorize,
        token,
        device: format!("{authority}/oauth2/v2.0/devicecode"),
        issuer: expected_issuer,
        jwks: jwks.to_owned(),
    })
}

#[derive(Clone, Deserialize)]
struct Claims {
    oid: String,
    tid: String,
    exp: u64,
    iat: u64,
    nbf: Option<u64>,
    nonce: Option<String>,
}

pub(crate) async fn verify(
    http: &dyn HttpTransport,
    options: &OAuthOptions,
    metadata: &Metadata,
    id_token: &str,
    nonce: Option<&str>,
    clock: &dyn Clock,
) -> Result<Account> {
    let header = decode_header(id_token)
        .map_err(|_| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
    if header.alg != Algorithm::RS256 {
        return fail(ErrorCode::IdentityVerificationFailed);
    }
    let kid = header.kid.ok_or_else(|| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
    let response = http.request(&metadata.jwks, None).await?;
    if response.status != 200 {
        return fail(ErrorCode::IdentityVerificationFailed);
    }
    let keys: JwkSet = serde_json::from_str(response.body.expose())
        .map_err(|_| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
    let jwk =
        keys.find(&kid).ok_or_else(|| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
    let key = DecodingKey::from_jwk(jwk)
        .map_err(|_| AuthError::new(ErrorCode::IdentityVerificationFailed))?;
    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[options.client_id.as_str()]);
    validation.set_issuer(&[metadata.issuer.as_str()]);
    validation.set_required_spec_claims(&["exp", "iat", "iss", "aud"]);
    // Use the same injectable clock as access-token expiry tests.
    validation.validate_exp = false;
    validation.validate_nbf = false;
    let claims = decode::<Claims>(id_token, &key, &validation)
        .map_err(|_| AuthError::new(ErrorCode::IdentityVerificationFailed))?
        .claims;
    let now = clock.now_ms() / 1000;
    if claims.exp <= now
        || claims.iat > now.saturating_add(60)
        || claims.nbf.is_some_and(|nbf| nbf > now.saturating_add(60))
        || !guid(&claims.oid)
        || !claims.tid.eq_ignore_ascii_case(&options.tenant())
        || nonce.is_some_and(|n| claims.nonce.as_deref() != Some(n))
    {
        return fail(ErrorCode::IdentityVerificationFailed);
    }
    Ok(Account { id: claims.oid.to_ascii_lowercase(), tenant: claims.tid.to_ascii_lowercase() })
}
