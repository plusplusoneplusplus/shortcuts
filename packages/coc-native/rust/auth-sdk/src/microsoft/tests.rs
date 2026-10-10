use super::*;
use crate::{Account, AuthError, Clock, CredentialStore, ErrorCode, Refresh, Result, Secret};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD, Engine};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

const TENANT: &str = "11111111-1111-4111-8111-111111111111";
const ACCOUNT: &str = "22222222-2222-4222-8222-222222222222";
const CLIENT: &str = "33333333-3333-4333-8333-333333333333";
const SUBSCRIPTION: &str = "44444444-4444-4444-8444-444444444444";
const NOW: u64 = 2_000_000_000_000;

// Generated, test-only RSA key; never used by production or any identity service.
const DER: &str =
    "MIIEpAIBAAKCAQEAm6RcDBDH7nFWabGG35Mgsghz00bBbi1c/HVtH1GRpac4u7yS0opFgoAv/ZTiN0tZUcJpBRHE5e0uMORjEN5yX6BMpzIOe2tsbETigtB/Ggq8DfYAPMUGVBha3qjvP71Ni2VAf2E4YROxUOPHM2/FyjH8VIZlzBY+CG8ot0R+G4ZE9c27fUqqRU+Urh/QmQi+vNHTwskJLPbxUBx3ZojCm1RNKhOcTC2vE0+v5acdGTDAPt/vubXR/2dFyFX8w47yhCeteCWQKF67hzN1USPK2RfJTi7JskT7ahwwKvmuFkwOWZcEa8j0GeTeWOnQFdmf9c4bb7jHEIelKDnLoZdWCwIDAQABAoIBADsI2okRDGSaxKYOWhQPYEVnA1fN7Kx3tF9lwuAwNkhY5yH+YspM/BSFvq42fJ9wiw6B6QetN7vmfLC60ACj/0naKXj5eZjCpDtk3W2026DrFW1OM8TZDo9zNXRjK2xHx1PqMc6e952KtKTz4KjX6nPJBeahm5cPkLPuRclNx290pIZ2FFGJyzHRDZYScvKbc6sfrpv0dsb4K2CFDZf5vA0ayeH4kLM2ez5jmHetNSlAgiZGhq9TG9ELyD3zY6NARjKnG5TaM/RfKWs/uZQTOXbwmtMHesWd0tsfhX0fapIR8y1nKRR60y3UxtzpPNsZ5YoiugX9LtQ//0xyp07JFPECgYEA1dk9ZO9ojMGVEksR32yx9i4emLbNCZllkzLYGRzHta1zo80wLOog4zbcTYKtCjZvbKiiT/NtEpr69N0rjThgcJmcQaiM319xa9vYZG9kjxlltm7ji6dEOaHoULAg/TqH5x3U52SChEQYmMsdT5MSOUAJjYZYhRuPuqPB7OV1ORUCgYEAulIHAosE5WRLhK6lIlPMeMeDaD2HmOK7oQwlg0pRMB7uU+swO/7s0znULm2L5E+s68pipcpYChiRisyFb/1+8cTWs2LI5loKudJv4YgJ8YP79SJK9L9ioQXoRpTu+t5ltAVBUMBMhDgrbDJzPK51FssagQKyqGQ+1g9f9Z+52p8CgYEA0B861w8BK2wDTuhsnotEr5i3Al12M09tQdML6XTPEIucreA2cJ/0He34fh8dlYDg9FkyjqkUkDTw5HqTtj8V7MAzCNunLoXO9u/hK+4VageHrANDxVim14gxdsXTdWAPf+jSmdiCBYPYhGu5PQafh8RBB9GmOPVX7ocNZybx7PkCgYAqFPDEYEXA0cBEvXVKpYafGODTIGKJ41vhae7nElf3+GR3y7zfMBqpMnx75/4amOxDbTiOnX74+MeWg873llefn4emiH87l8aoZaEjXShxxg+YNCCd2sQZ/k2R831uZ+Csois4Y9ZkXpNgIpzobbbAaSsZTFSxt8KBcoOH5IWDnQKBgQCoEysDk5OkMw4YhMSSjRX8uBJUxcQ8WnttTi1qAn+0X+gZDKvhjRDdMg67Q+ccx+jHI6UzOG9Qxy9lGPMoifiIARpOdjXElP7D+vLzvG+ol4b5D/w41oPz9lZYYhsR5lZYhLqm870v2sS3J++ynllyHJtjFkNsSeiP0wYNDl9sAQ=="
;
const MODULUS: &str = "m6RcDBDH7nFWabGG35Mgsghz00bBbi1c_HVtH1GRpac4u7yS0opFgoAv_ZTiN0tZUcJpBRHE5e0uMORjEN5yX6BMpzIOe2tsbETigtB_Ggq8DfYAPMUGVBha3qjvP71Ni2VAf2E4YROxUOPHM2_FyjH8VIZlzBY-CG8ot0R-G4ZE9c27fUqqRU-Urh_QmQi-vNHTwskJLPbxUBx3ZojCm1RNKhOcTC2vE0-v5acdGTDAPt_vubXR_2dFyFX8w47yhCeteCWQKF67hzN1USPK2RfJTi7JskT7ahwwKvmuFkwOWZcEa8j0GeTeWOnQFdmf9c4bb7jHEIelKDnLoZdWCw";

struct FakeClock(AtomicU64);
impl Clock for FakeClock {
    fn now_ms(&self) -> u64 {
        self.0.load(Ordering::SeqCst)
    }
}
#[derive(Default)]
struct MemoryStore {
    values: Mutex<HashMap<String, Secret>>,
    writes: AtomicUsize,
    fail_write: Mutex<Option<ErrorCode>>,
}
impl CredentialStore for MemoryStore {
    fn read(&self, key: &str) -> Result<Option<Secret>> {
        Ok(self.values.lock().unwrap().get(key).cloned())
    }
    fn write(&self, key: &str, value: &Secret) -> Result<()> {
        if let Some(code) = *self.fail_write.lock().unwrap() {
            return Err(AuthError::new(code));
        }
        self.writes.fetch_add(1, Ordering::SeqCst);
        self.values.lock().unwrap().insert(key.to_owned(), value.clone());
        Ok(())
    }
    fn delete(&self, key: &str) -> Result<()> {
        self.values.lock().unwrap().remove(key);
        Ok(())
    }
}

struct FakeHttp {
    calls: AtomicUsize,
    grants: AtomicUsize,
    nonce: Mutex<Option<String>>,
    claim_override: Mutex<Option<serde_json::Value>>,
    pending: Mutex<VecDeque<&'static str>>,
    requests: Mutex<Vec<Vec<(String, String)>>>,
    delay: Mutex<Duration>,
    refresh_id: bool,
}
impl Default for FakeHttp {
    fn default() -> Self {
        Self {
            calls: AtomicUsize::new(0),
            grants: AtomicUsize::new(0),
            nonce: Mutex::default(),
            claim_override: Mutex::default(),
            pending: Mutex::default(),
            requests: Mutex::default(),
            delay: Mutex::new(Duration::ZERO),
            refresh_id: true,
        }
    }
}
fn output(status: u16, value: serde_json::Value) -> HttpResponse {
    HttpResponse { status, body: Secret::new(value.to_string()) }
}
#[async_trait]
impl HttpTransport for FakeHttp {
    async fn request(&self, url: &str, form: Option<&[(String, String)]>) -> Result<HttpResponse> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let delay = *self.delay.lock().unwrap();
        tokio::time::sleep(delay).await;
        if url.ends_with("openid-configuration") {
            let base = format!("https://login.microsoftonline.com/{TENANT}");
            return Ok(output(
                200,
                serde_json::json!({
                    "issuer":format!("{base}/v2.0"),
                    "authorization_endpoint":format!("{base}/oauth2/v2.0/authorize"),
                    "token_endpoint":format!("{base}/oauth2/v2.0/token"),
                    "jwks_uri":"https://login.microsoftonline.com/common/discovery/v2.0/keys",
                }),
            ));
        }
        if url.ends_with("/keys") {
            return Ok(output(
                200,
                serde_json::json!({"keys":[
                    {"kty":"RSA","kid":"fixture","use":"sig","alg":"RS256","n":MODULUS,"e":"AQAB"}
                ]}),
            ));
        }
        if url.ends_with("/devicecode") {
            return Ok(output(
                200,
                serde_json::json!({
                    "device_code":"fixture-device","user_code":"TEST-CODE",
                    "verification_uri":"https://microsoft.com/devicelogin","expires_in":600,"interval":1,
                }),
            ));
        }
        assert!(url.ends_with("/token"));
        let form = form.unwrap();
        self.requests.lock().unwrap().push(form.to_vec());
        if let Some(error) = self.pending.lock().unwrap().pop_front() {
            return Ok(output(
                400,
                serde_json::json!({"error":error,"error_description":"fixture-private"}),
            ));
        }
        let grant = self.grants.fetch_add(1, Ordering::SeqCst);
        let mut claims = serde_json::json!({
            "iss":format!("https://login.microsoftonline.com/{TENANT}/v2.0"),
            "aud":CLIENT,"iat":NOW/1000,"exp":NOW/1000+86400,"tid":TENANT,"oid":ACCOUNT,
        });
        if let Some(nonce) = self.nonce.lock().unwrap().clone() {
            claims["nonce"] = nonce.into();
        }
        if let Some(overrides) = self.claim_override.lock().unwrap().as_ref() {
            for (key, value) in overrides.as_object().unwrap() {
                claims[key] = value.clone();
            }
        }
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("fixture".into());
        let id =
            encode(&header, &claims, &EncodingKey::from_rsa_der(&STANDARD.decode(DER).unwrap()))
                .unwrap();
        let mut response = serde_json::json!({
            "access_token":format!("opaque-fixture-{grant}"),"token_type":"Bearer","expires_in":3600,
            "refresh_token":format!("rotated-fixture-{grant}"),"scope":"actual.granted",
        });
        if self.refresh_id || !form.iter().any(|(k, v)| k == "grant_type" && v == "refresh_token") {
            response["id_token"] = id.into();
        }
        Ok(output(200, response))
    }
}

struct FakeCli {
    calls: AtomicUsize,
    expires: AtomicU64,
    mismatch: bool,
}
#[async_trait]
impl CliRunner for FakeCli {
    async fn run(&self, args: &[String]) -> Result<CliOutput> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(args.windows(2).any(|w| w == ["--subscription", SUBSCRIPTION]));
        let value = if args[1] == "show" {
            serde_json::json!({"id":SUBSCRIPTION,"tenantId":TENANT,
                "user":{"name":if self.mismatch {"other-fixture"} else {"fixture-account"},"type":"user"}})
        } else {
            assert!(!args.iter().any(|argument| argument == "--tenant"));
            assert!(args.windows(2).any(|w| w == ["--resource", "https://resource.example"]));
            serde_json::json!({"accessToken":"opaque-cli-fixture","tokenType":"Bearer",
                "tenant":TENANT,"subscription":SUBSCRIPTION,"expires_on":self.expires.load(Ordering::SeqCst)})
        };
        Ok(CliOutput { success: true, stdout: Secret::new(value.to_string()) })
    }
}

struct Fixture {
    directory: tempfile::TempDir,
    clock: Arc<FakeClock>,
    store: Arc<MemoryStore>,
    http: Arc<FakeHttp>,
    cli: Arc<FakeCli>,
    deps: Arc<Dependencies>,
}
impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700))
                .unwrap();
        }
        let clock = Arc::new(FakeClock(AtomicU64::new(NOW)));
        let store = Arc::new(MemoryStore::default());
        let http = Arc::new(FakeHttp::default());
        let cli = Arc::new(FakeCli {
            calls: AtomicUsize::new(0),
            expires: AtomicU64::new(NOW / 1000 + 3600),
            mismatch: false,
        });
        let deps = Arc::new(Dependencies {
            clock: clock.clone(),
            store: store.clone(),
            http: http.clone(),
            cli: cli.clone(),
        });
        Self { directory, clock, store, http, cli, deps }
    }
    fn oauth(&self) -> OAuthOptions {
        OAuthOptions {
            namespace: "fixture".into(),
            authority: format!("https://login.microsoftonline.com/{TENANT}"),
            client_id: CLIENT.into(),
            scopes: vec!["openid".into(), "offline_access".into(), "requested.scope".into()],
            target: "fixture-resource".into(),
            resource: None,
            coordination_dir: self.directory.path().to_path_buf(),
        }
    }
    fn seed(&self, options: &OAuthOptions) {
        let account = Account { id: ACCOUNT.into(), tenant: TENANT.into() };
        self.store
            .write(
                &options.credential_key(&account),
                &Secret::new(format!("v1\n{TENANT}\n{ACCOUNT}\ninitial-fixture")),
            )
            .unwrap();
    }
    fn provider(&self, refresh: Refresh, oauth: bool) -> MicrosoftTokenProvider {
        MicrosoftTokenProvider::with_dependencies(self.options(refresh, oauth), self.deps.clone())
            .unwrap()
    }
    fn options(&self, refresh: Refresh, oauth: bool) -> ProviderOptions {
        let source = if oauth {
            MicrosoftTokenSource::OAuth {
                options: self.oauth(),
                account: Account { id: ACCOUNT.into(), tenant: TENANT.into() },
            }
        } else {
            MicrosoftTokenSource::AzureCli(AzureCliOptions {
                namespace: "fixture".into(),
                selection: AzureCliSelection::Explicit {
                    account: Account { id: "fixture-account".into(), tenant: TENANT.into() },
                    subscription: SUBSCRIPTION.into(),
                },
                resource: "https://resource.example".into(),
            })
        };
        ProviderOptions {
            source,
            refresh,
            expiry_margin_seconds: 60,
            timeout: Duration::from_secs(2),
        }
    }
    fn signin(&self, expected: Option<Account>) -> MicrosoftOAuthSignIn {
        MicrosoftOAuthSignIn::with_dependencies(
            self.oauth(),
            expected,
            Duration::from_secs(30),
            self.deps.clone(),
        )
        .unwrap()
    }
}
fn code<T>(result: Result<T>) -> ErrorCode {
    match result {
        Ok(_) => panic!("expected error"),
        Err(error) => error.code,
    }
}

struct ActiveCli {
    calls: Mutex<Vec<Vec<String>>>,
    selection: Mutex<serde_json::Value>,
    token_calls: AtomicUsize,
    expires: AtomicU64,
    fail: Mutex<Option<ErrorCode>>,
    switch_during_token: std::sync::atomic::AtomicBool,
}
impl ActiveCli {
    fn new() -> Self {
        Self {
            calls: Mutex::default(),
            selection: Mutex::new(serde_json::json!({
                "id":SUBSCRIPTION,"tenantId":TENANT,"user":{"name":"fixture-account","type":"user"}
            })),
            token_calls: AtomicUsize::new(0),
            expires: AtomicU64::new(NOW / 1000 + 3600),
            fail: Mutex::default(),
            switch_during_token: std::sync::atomic::AtomicBool::new(false),
        }
    }
}
#[async_trait]
impl CliRunner for ActiveCli {
    async fn run(&self, args: &[String]) -> Result<CliOutput> {
        self.calls.lock().unwrap().push(args.to_vec());
        if let Some(error) = *self.fail.lock().unwrap() {
            return Err(AuthError::new(error));
        }
        let value = if args[1] == "show" {
            self.selection.lock().unwrap().clone()
        } else {
            assert_eq!(args[1], "get-access-token");
            assert!(args.windows(2).any(|w| w == ["--subscription", SUBSCRIPTION]));
            self.token_calls.fetch_add(1, Ordering::SeqCst);
            if self.switch_during_token.load(Ordering::SeqCst) {
                self.selection.lock().unwrap()["user"]["name"] = "other-fixture".into();
            }
            serde_json::json!({"accessToken":"opaque-cli-fixture","tokenType":"Bearer",
                "tenant":TENANT,"subscription":SUBSCRIPTION,"expires_on":self.expires.load(Ordering::SeqCst)})
        };
        Ok(CliOutput { success: true, stdout: Secret::new(value.to_string()) })
    }
}
fn active_provider(f: &Fixture, cli: Arc<ActiveCli>, refresh: Refresh) -> MicrosoftTokenProvider {
    let deps = Arc::new(Dependencies {
        clock: f.clock.clone(),
        store: f.store.clone(),
        http: f.http.clone(),
        cli,
    });
    MicrosoftTokenProvider::with_dependencies(
        ProviderOptions::new(
            MicrosoftTokenSource::AzureCli(AzureCliOptions {
                namespace: "fixture-active".into(),
                resource: "https://resource.example".into(),
                selection: AzureCliSelection::ActiveAccount,
            }),
            refresh,
        ),
        deps,
    )
    .unwrap()
}

#[tokio::test]
async fn active_cli_pins_selection_and_checks_it_before_cached_tokens_and_renewal() {
    let f = Fixture::new();
    let cli = Arc::new(ActiveCli::new());
    let p = active_provider(&f, cli.clone(), Refresh::Auto);
    assert!(cli.calls.lock().unwrap().is_empty());
    let cancel = CancellationToken::new();
    let first = p.get_token(false, &cancel).await.unwrap();
    assert_eq!(first.account.id, "fixture-account");
    p.get_token(false, &cancel).await.unwrap();
    assert_eq!(cli.token_calls.load(Ordering::SeqCst), 1);
    f.clock.0.store(first.expires_at - 60_000, Ordering::SeqCst);
    cli.expires.store(NOW / 1000 + 7200, Ordering::SeqCst);
    p.get_token(false, &cancel).await.unwrap();
    assert_eq!(cli.token_calls.load(Ordering::SeqCst), 2);
    p.get_token(true, &cancel).await.unwrap();
    assert_eq!(cli.token_calls.load(Ordering::SeqCst), 3);
    cli.selection.lock().unwrap()["id"] = CLIENT.into();
    assert_eq!(code(p.get_token(false, &cancel).await), ErrorCode::AccountMismatch);
    assert_eq!(cli.token_calls.load(Ordering::SeqCst), 3);
    assert_eq!(f.http.calls.load(Ordering::SeqCst), 0);
    assert_eq!(f.store.writes.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn active_cli_rejects_ambiguous_selection_and_switches_during_acquisition() {
    let f = Fixture::new();
    let cli = Arc::new(ActiveCli::new());
    let cancel = CancellationToken::new();
    for (field, value, expected) in [
        ("id", "invalid", ErrorCode::InvalidTokenResponse),
        ("tenantId", "invalid", ErrorCode::InvalidTokenResponse),
        ("type", "servicePrincipal", ErrorCode::AccountMismatch),
    ] {
        let saved = cli.selection.lock().unwrap().clone();
        if field == "type" {
            cli.selection.lock().unwrap()["user"][field] = value.into();
        } else {
            cli.selection.lock().unwrap()[field] = value.into();
        }
        let p = active_provider(&f, cli.clone(), Refresh::Auto);
        assert_eq!(code(p.get_token(false, &cancel).await), expected);
        *cli.selection.lock().unwrap() = saved;
    }
    assert_eq!(cli.token_calls.load(Ordering::SeqCst), 0);
    cli.switch_during_token.store(true, Ordering::SeqCst);
    let p = active_provider(&f, cli.clone(), Refresh::Auto);
    assert_eq!(code(p.get_token(false, &cancel).await), ErrorCode::AccountMismatch);
    assert_eq!(cli.token_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn active_cli_failure_and_never_policy_do_not_fall_back() {
    let f = Fixture::new();
    let cli = Arc::new(ActiveCli::new());
    let p = active_provider(&f, cli.clone(), Refresh::Never);
    let cancel = CancellationToken::new();
    assert_eq!(code(p.get_token(true, &cancel).await), ErrorCode::RefreshDisabled);
    assert!(cli.calls.lock().unwrap().is_empty());
    for failure in
        [ErrorCode::CliUnavailable, ErrorCode::LoginRequired, ErrorCode::InvalidTokenResponse]
    {
        *cli.fail.lock().unwrap() = Some(failure);
        assert_eq!(code(p.get_token(false, &cancel).await), failure);
    }
    *cli.fail.lock().unwrap() = None;
    let first = p.get_token(false, &cancel).await.unwrap();
    f.clock.0.store(first.expires_at - 60_000, Ordering::SeqCst);
    assert_eq!(code(p.get_token(false, &cancel).await), ErrorCode::RefreshDisabled);
    assert_eq!(cli.token_calls.load(Ordering::SeqCst), 1);
    assert_eq!(f.http.calls.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn construction_is_validation_only_and_rejects_unsafe_configuration() {
    let f = Fixture::new();
    let p = f.provider(Refresh::Auto, true);
    let _signin = f.signin(None);
    assert_eq!(f.http.calls.load(Ordering::SeqCst), 0);
    assert_eq!(f.store.writes.load(Ordering::SeqCst), 0);
    assert_eq!(std::fs::read_dir(f.directory.path()).unwrap().count(), 0);
    p.dispose();
    for authority in [
        "http://login.microsoftonline.com/x",
        "https://attacker.example/x",
        "https://login.microsoftonline.com/common",
        "https://login.microsoftonline.com/../common",
    ] {
        let mut options = f.oauth();
        options.authority = authority.into();
        assert_eq!(code(options.validate()), ErrorCode::InvalidConfiguration);
        let mut active = f.options(Refresh::Auto, false);
        if let MicrosoftTokenSource::AzureCli(ref mut o) = active.source {
            o.selection = AzureCliSelection::ActiveAccount;
        }
        assert!(active.validate().is_ok());
        assert_ne!(active.key(), f.options(Refresh::Auto, false).key());
        if let MicrosoftTokenSource::AzureCli(ref mut o) = active.source {
            o.selection = AzureCliSelection::Explicit {
                account: Account { id: "fixture-account".into(), tenant: "invalid".into() },
                subscription: SUBSCRIPTION.into(),
            };
        }
        assert_eq!(code(active.validate()), ErrorCode::InvalidConfiguration);
    }
    let mut options = f.options(Refresh::Auto, false);
    if let MicrosoftTokenSource::AzureCli(ref mut o) = options.source {
        o.resource = "fixture&command".into();
    }
    assert_eq!(code(options.validate()), ErrorCode::InvalidConfiguration);
}

#[tokio::test]
async fn exact_margin_auto_and_never_state_machine() {
    for oauth in [false, true] {
        for refresh in [Refresh::Auto, Refresh::Never] {
            let f = Fixture::new();
            f.seed(&f.oauth());
            let p = f.provider(refresh, oauth);
            let cancel = CancellationToken::new();
            let first = p.get_token(false, &cancel).await.unwrap();
            f.clock.0.store(first.expires_at - 60_001, Ordering::SeqCst);
            assert_eq!(
                p.get_token(false, &cancel).await.unwrap().access_token.expose(),
                first.access_token.expose()
            );
            f.clock.0.store(first.expires_at - 60_000, Ordering::SeqCst);
            if refresh == Refresh::Never {
                assert_eq!(code(p.get_token(false, &cancel).await), ErrorCode::RefreshDisabled);
                assert_eq!(code(p.get_token(true, &cancel).await), ErrorCode::RefreshDisabled);
                p.invalidate().await.unwrap();
                assert_eq!(code(p.get_token(false, &cancel).await), ErrorCode::RefreshDisabled);
            } else if oauth {
                assert!(p.get_token(false, &cancel).await.unwrap().expires_at > first.expires_at);
                assert_eq!(f.http.grants.load(Ordering::SeqCst), 2);
                p.get_token(true, &cancel).await.unwrap();
                assert_eq!(f.http.grants.load(Ordering::SeqCst), 3);
            } else {
                f.cli.expires.store(first.expires_at / 1000 + 3600, Ordering::SeqCst);
                p.get_token(false, &cancel).await.unwrap();
                assert_eq!(f.cli.calls.load(Ordering::SeqCst), 6);
            }
        }
    }
}

#[tokio::test]
async fn never_retries_failed_initial_acquisition_but_force_always_rejects() {
    let f = Fixture::new();
    let p = f.provider(Refresh::Never, true);
    let c = CancellationToken::new();
    assert_eq!(code(p.get_token(true, &c).await), ErrorCode::RefreshDisabled);
    assert_eq!(code(p.get_token(false, &c).await), ErrorCode::InteractionRequired);
    p.invalidate().await.unwrap();
    f.seed(&f.oauth());
    p.get_token(false, &c).await.unwrap();
    p.invalidate().await.unwrap();
    assert_eq!(code(p.get_token(false, &c).await), ErrorCode::RefreshDisabled);
}

#[tokio::test]
async fn concurrent_same_key_operations_and_force_refresh_are_single_flight() {
    let f = Fixture::new();
    f.seed(&f.oauth());
    let p = f.provider(Refresh::Auto, true);
    let q = f.provider(Refresh::Auto, true);
    let c = CancellationToken::new();
    let (a, b, d) =
        tokio::join!(p.get_token(false, &c), q.get_token(false, &c), p.get_token(false, &c));
    assert_eq!(a.unwrap().access_token.expose(), b.unwrap().access_token.expose());
    d.unwrap();
    assert_eq!(f.http.grants.load(Ordering::SeqCst), 1);
    let (a, b) = tokio::join!(p.get_token(true, &c), q.get_token(true, &c));
    a.unwrap();
    b.unwrap();
    assert_eq!(f.http.grants.load(Ordering::SeqCst), 2);
    p.invalidate().await.unwrap();
    p.get_token(false, &c).await.unwrap();
    assert_eq!(f.http.grants.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn rotation_is_serialized_across_targets_and_keys_are_isolated() {
    let f = Fixture::new();
    f.seed(&f.oauth());
    let first = f.provider(Refresh::Auto, true);
    let mut options = f.options(Refresh::Auto, true);
    if let MicrosoftTokenSource::OAuth { options, .. } = &mut options.source {
        options.target = "second-target".into();
        options.scopes.push("second.scope".into());
    }
    let second = MicrosoftTokenProvider::with_dependencies(options, f.deps.clone()).unwrap();
    let c = CancellationToken::new();
    let (a, b) = tokio::join!(first.get_token(false, &c), second.get_token(false, &c));
    a.unwrap();
    b.unwrap();
    let requests = f.http.requests.lock().unwrap().clone();
    assert_eq!(requests.len(), 2);
    let refresh =
        |i: usize| requests[i].iter().find(|(k, _)| k == "refresh_token").unwrap().1.clone();
    assert_eq!(refresh(0), "initial-fixture");
    assert_eq!(refresh(1), "rotated-fixture-0");
    drop(requests);
    for field in ["namespace", "client", "account", "directory"] {
        let mut options = f.options(Refresh::Auto, true);
        if let MicrosoftTokenSource::OAuth { options, account } = &mut options.source {
            match field {
                "namespace" => options.namespace = "other".into(),
                "client" => options.client_id = SUBSCRIPTION.into(),
                "account" => account.id = SUBSCRIPTION.into(),
                _ => options.coordination_dir = options.coordination_dir.join("missing"),
            }
        }
        let p = MicrosoftTokenProvider::with_dependencies(options, f.deps.clone()).unwrap();
        let error = code(p.get_token(false, &c).await);
        assert!(matches!(
            error,
            ErrorCode::InteractionRequired | ErrorCode::CoordinationUnavailable
        ));
    }
}

#[tokio::test]
async fn opaque_access_tokens_and_trusted_identity_granted_scopes() {
    let f = Fixture::new();
    f.seed(&f.oauth());
    let p = f.provider(Refresh::Auto, true);
    let t = p.get_token(false, &CancellationToken::new()).await.unwrap();
    assert!(t.access_token.expose().starts_with("opaque-"));
    assert_eq!(t.account.id, ACCOUNT);
    assert_eq!(t.granted_scopes, Some(vec!["actual.granted".into()]));
    let cli =
        f.provider(Refresh::Auto, false).get_token(false, &CancellationToken::new()).await.unwrap();
    assert!(cli.granted_scopes.is_none());
}

#[tokio::test]
async fn failures_are_shared_and_redacted_and_storage_failure_is_not_success() {
    let f = Fixture::new();
    f.seed(&f.oauth());
    f.http.pending.lock().unwrap().push_back("invalid_grant");
    let p = f.provider(Refresh::Auto, true);
    let q = f.provider(Refresh::Auto, true);
    let c = CancellationToken::new();
    let (a, b) = tokio::join!(p.get_token(false, &c), q.get_token(false, &c));
    assert_eq!(code(a), ErrorCode::InteractionRequired);
    assert_eq!(code(b), ErrorCode::InteractionRequired);
    assert_eq!(f.http.requests.lock().unwrap().len(), 1);
    *f.store.fail_write.lock().unwrap() = Some(ErrorCode::StorageFailed);
    assert_eq!(code(p.get_token(false, &c).await), ErrorCode::StorageFailed);
    assert_eq!(
        format!("{}", AuthError::new(ErrorCode::StorageFailed)),
        "Authentication failed: StorageFailed."
    );
}

#[tokio::test]
async fn cancellation_timeout_disposal_prevent_publishing_and_initial_retry_is_allowed() {
    let f = Fixture::new();
    f.seed(&f.oauth());
    *f.http.delay.lock().unwrap() = Duration::from_secs(10);
    let mut options = f.options(Refresh::Never, true);
    options.timeout = Duration::from_millis(100);
    let p = MicrosoftTokenProvider::with_dependencies(options, f.deps.clone()).unwrap();
    assert_eq!(code(p.get_token(false, &CancellationToken::new()).await), ErrorCode::TimedOut);
    let c = CancellationToken::new();
    c.cancel();
    assert_eq!(code(p.get_token(false, &c).await), ErrorCode::Cancelled);
    let c = CancellationToken::new();
    let (_, result) = tokio::join!(
        async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            p.dispose();
        },
        p.get_token(false, &c),
    );
    assert_eq!(code(result), ErrorCode::Disposed);
    assert_eq!(f.store.writes.load(Ordering::SeqCst), 1);
    assert_eq!(code(p.invalidate().await), ErrorCode::Disposed);
    assert_eq!(code(p.get_token(false, &c).await), ErrorCode::Disposed);
}

#[tokio::test]
async fn browser_pkce_state_nonce_and_durable_bootstrap() {
    let f = Fixture::new();
    let signin = f.signin(None);
    let instructions = signin.begin_browser().await.unwrap();
    let url = url::Url::parse(instructions.authorization_url.as_deref().unwrap()).unwrap();
    let pairs: HashMap<_, _> =
        url.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    assert_eq!(pairs["code_challenge_method"], "S256");
    assert_eq!(pairs["response_type"], "code");
    *f.http.nonce.lock().unwrap() = Some(pairs["nonce"].clone());
    let redirect = pairs["redirect_uri"].clone();
    let callback = format!("{redirect}?code=fixture-code&state={}", pairs["state"]);
    let (result, request) = tokio::join!(signin.wait(), reqwest::get(callback));
    let result = result.unwrap();
    request.unwrap();
    assert_eq!(result.account.id, ACCOUNT);
    assert_eq!(f.store.writes.load(Ordering::SeqCst), 1);
    let forms = f.http.requests.lock().unwrap().clone();
    let verifier = forms[0].iter().find(|(k, _)| k == "code_verifier").unwrap().1.as_str();
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(sha2::Sha256::digest(verifier.as_bytes()));
    assert_eq!(challenge, pairs["code_challenge"]);
    drop(forms);
    f.provider(Refresh::Never, true).get_token(false, &CancellationToken::new()).await.unwrap();
}

#[tokio::test]
async fn browser_state_mismatch_closes_listener_without_exchange() {
    let f = Fixture::new();
    let signin = f.signin(None);
    let instructions = signin.begin_browser().await.unwrap();
    let url = url::Url::parse(instructions.authorization_url.as_ref().unwrap()).unwrap();
    let redirect = url.query_pairs().find(|(k, _)| k == "redirect_uri").unwrap().1.to_string();
    let (result, _) =
        tokio::join!(signin.wait(), reqwest::get(format!("{redirect}?state=wrong&code=fixture")));
    assert_eq!(code(result), ErrorCode::IdentityVerificationFailed);
    assert_eq!(f.http.grants.load(Ordering::SeqCst), 0);
    assert!(reqwest::get(redirect).await.is_err());
}

#[tokio::test(start_paused = true)]
async fn device_pending_slow_down_and_bootstrap() {
    let f = Fixture::new();
    f.http.pending.lock().unwrap().extend(["authorization_pending", "slow_down"]);
    let signin = f.signin(None);
    let info = signin.begin_device().await.unwrap();
    assert_eq!(info.user_code.as_deref(), Some("TEST-CODE"));
    let start = tokio::time::Instant::now();
    let result = signin.wait().await.unwrap();
    assert!(start.elapsed() >= Duration::from_secs(8));
    assert_eq!(result.account.id, ACCOUNT);
    assert_eq!(f.store.writes.load(Ordering::SeqCst), 1);
}

#[tokio::test(start_paused = true)]
async fn device_grant_preserves_an_explicit_resource_indicator() {
    let f = Fixture::new();
    let mut options = f.oauth();
    options.resource = Some("https://resource.example".into());
    let signin = MicrosoftOAuthSignIn::with_dependencies(
        options,
        None,
        Duration::from_secs(30),
        f.deps.clone(),
    )
    .unwrap();
    signin.begin_device().await.unwrap();
    signin.wait().await.unwrap();
    let forms = f.http.requests.lock().unwrap();
    assert!(forms[0]
        .iter()
        .any(|(key, value)| key == "resource" && value == "https://resource.example"));
}

#[tokio::test(start_paused = true)]
async fn device_denial_expiry_and_identity_errors_never_persist() {
    for (error, expected) in [
        ("authorization_declined", ErrorCode::AccessDenied),
        ("expired_token", ErrorCode::TokenExpired),
    ] {
        let f = Fixture::new();
        f.http.pending.lock().unwrap().push_back(error);
        let signin = f.signin(None);
        signin.begin_device().await.unwrap();
        assert_eq!(code(signin.wait().await), expected);
        assert_eq!(f.store.writes.load(Ordering::SeqCst), 0);
    }
    for overrides in [
        serde_json::json!({"aud":SUBSCRIPTION}),
        serde_json::json!({"tid":SUBSCRIPTION}),
        serde_json::json!({"iss":"https://attacker.example"}),
        serde_json::json!({"exp":NOW/1000}),
    ] {
        let f = Fixture::new();
        *f.http.claim_override.lock().unwrap() = Some(overrides);
        let signin = f.signin(None);
        signin.begin_device().await.unwrap();
        assert_eq!(code(signin.wait().await), ErrorCode::IdentityVerificationFailed);
        assert_eq!(f.store.writes.load(Ordering::SeqCst), 0);
    }
    let f = Fixture::new();
    let signin = f.signin(Some(Account { id: SUBSCRIPTION.into(), tenant: TENANT.into() }));
    signin.begin_device().await.unwrap();
    assert_eq!(code(signin.wait().await), ErrorCode::AccountMismatch);
}

#[tokio::test]
async fn signin_cancel_dispose_and_unattended_deadline_close_listeners() {
    let f = Fixture::new();
    for dispose in [false, true] {
        let signin = f.signin(None);
        let info = signin.begin_browser().await.unwrap();
        let url = url::Url::parse(info.authorization_url.as_ref().unwrap()).unwrap();
        let redirect = url.query_pairs().find(|(k, _)| k == "redirect_uri").unwrap().1.to_string();
        if dispose {
            signin.dispose();
        } else {
            signin.cancel();
        }
        assert!(reqwest::get(redirect).await.is_err());
        assert_eq!(
            code(signin.wait().await),
            if dispose { ErrorCode::Disposed } else { ErrorCode::Cancelled }
        );
    }
    let signin = MicrosoftOAuthSignIn::with_dependencies(
        f.oauth(),
        None,
        Duration::from_millis(100),
        f.deps.clone(),
    )
    .unwrap();
    let info = signin.begin_browser().await.unwrap();
    let url = url::Url::parse(info.authorization_url.as_ref().unwrap()).unwrap();
    let redirect = url.query_pairs().find(|(k, _)| k == "redirect_uri").unwrap().1.to_string();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(reqwest::get(redirect).await.is_err());
    assert_eq!(code(signin.wait().await), ErrorCode::TimedOut);
}

#[tokio::test]
async fn deletion_is_exact_and_preserves_never_state() {
    let f = Fixture::new();
    let first = f.oauth();
    let mut second = f.oauth();
    second.namespace = "other-fixture".into();
    f.seed(&first);
    f.seed(&second);
    let p = f.provider(Refresh::Never, true);
    let c = CancellationToken::new();
    p.get_token(false, &c).await.unwrap();
    p.delete_credentials(&c).await.unwrap();
    assert_eq!(f.store.values.lock().unwrap().len(), 1);
    assert_eq!(code(p.get_token(false, &c).await), ErrorCode::RefreshDisabled);
}

#[tokio::test]
async fn advisory_lock_contention_is_bounded_and_released() {
    let f = Fixture::new();
    f.seed(&f.oauth());
    let key = f.oauth().credential_key(&Account { id: ACCOUNT.into(), tenant: TENANT.into() });
    let lock = coordination::CredentialLock::acquire(f.directory.path(), &key).await.unwrap();
    let mut options = f.options(Refresh::Auto, true);
    options.timeout = Duration::from_millis(100);
    let p = MicrosoftTokenProvider::with_dependencies(options, f.deps.clone()).unwrap();
    assert_eq!(code(p.get_token(false, &CancellationToken::new()).await), ErrorCode::TimedOut);
    drop(lock);
    p.get_token(false, &CancellationToken::new()).await.unwrap();
}

#[test]
fn malformed_token_response_and_no_granted_scope_fabrication() {
    for value in [
        "{}",
        r#"{"access_token":"","token_type":"Bearer","expires_in":3600}"#,
        r#"{"access_token":"opaque","token_type":"Bearer","expires_in":-1}"#,
        r#"{"access_token":"opaque","token_type":"other","expires_in":3600}"#,
    ] {
        assert_eq!(code(oauth::response(value, 200)), ErrorCode::InvalidTokenResponse);
    }
    let result = oauth::response(
        r#"{"access_token":"opaque","token_type":"Bearer","expires_in":3600}"#,
        200,
    )
    .unwrap();
    assert!(result.scope.is_none());
}

use sha2::Digest;

#[tokio::test]
async fn cancelled_waiter_does_not_cancel_another_provider() {
    let f = Fixture::new();
    f.seed(&f.oauth());
    *f.http.delay.lock().unwrap() = Duration::from_millis(20);
    let first = f.provider(Refresh::Auto, true);
    let second = f.provider(Refresh::Auto, true);
    let cancel = CancellationToken::new();
    let other = CancellationToken::new();
    let (a, b, _) =
        tokio::join!(first.get_token(false, &other), second.get_token(false, &cancel), async {
            tokio::time::sleep(Duration::from_millis(10)).await;
            cancel.cancel();
        },);
    a.unwrap();
    assert_eq!(code(b), ErrorCode::Cancelled);
    assert_eq!(f.http.grants.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn source_tenant_client_scopes_and_namespace_never_share_access_tokens() {
    let f = Fixture::new();
    f.seed(&f.oauth());
    let first = f.provider(Refresh::Auto, true);
    let c = CancellationToken::new();
    first.get_token(false, &c).await.unwrap();
    let mut opts = f.options(Refresh::Auto, true);
    if let MicrosoftTokenSource::OAuth { options, .. } = &mut opts.source {
        options.scopes.push("another.scope".into());
    }
    let scopes = MicrosoftTokenProvider::with_dependencies(opts, f.deps.clone()).unwrap();
    assert_ne!(
        first.get_token(false, &c).await.unwrap().access_token.expose(),
        scopes.get_token(false, &c).await.unwrap().access_token.expose()
    );
    let cli = f.provider(Refresh::Auto, false);
    assert_eq!(cli.get_token(false, &c).await.unwrap().source, "azure-cli");
    let mut cli_opts = f.options(Refresh::Auto, false);
    if let MicrosoftTokenSource::AzureCli(ref mut options) = cli_opts.source {
        options.namespace = "another-cli-namespace".into();
    }
    MicrosoftTokenProvider::with_dependencies(cli_opts, f.deps.clone())
        .unwrap()
        .get_token(false, &c)
        .await
        .unwrap();
    assert_eq!(f.cli.calls.load(Ordering::SeqCst), 6);
    let mut oauth = f.oauth();
    oauth.authority = format!("https://login.microsoftonline.com/{SUBSCRIPTION}");
    let account = Account { id: ACCOUNT.into(), tenant: SUBSCRIPTION.into() };
    let opts = ProviderOptions {
        source: MicrosoftTokenSource::OAuth { options: oauth, account },
        refresh: Refresh::Auto,
        expiry_margin_seconds: 60,
        timeout: Duration::from_secs(1),
    };
    let other = MicrosoftTokenProvider::with_dependencies(opts, f.deps.clone()).unwrap();
    assert_eq!(code(other.get_token(false, &c).await), ErrorCode::InteractionRequired);
}

#[tokio::test]
async fn refresh_without_id_token_uses_only_our_verified_stored_account() {
    let mut f = Fixture::new();
    let http = Arc::new(FakeHttp { refresh_id: false, ..FakeHttp::default() });
    f.deps = Arc::new(Dependencies {
        clock: f.clock.clone(),
        store: f.store.clone(),
        http,
        cli: f.cli.clone(),
    });
    f.seed(&f.oauth());
    let token =
        f.provider(Refresh::Auto, true).get_token(false, &CancellationToken::new()).await.unwrap();
    assert_eq!(token.account.id, ACCOUNT);
}

#[tokio::test]
async fn browser_nonce_mismatch_rejects_before_storage() {
    let f = Fixture::new();
    let signin = f.signin(None);
    let instructions = signin.begin_browser().await.unwrap();
    let url = url::Url::parse(instructions.authorization_url.as_ref().unwrap()).unwrap();
    let query: HashMap<_, _> =
        url.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    *f.http.nonce.lock().unwrap() = Some("wrong-nonce".into());
    let callback = format!("{}?code=fixture&state={}", query["redirect_uri"], query["state"]);
    let (result, _) = tokio::join!(signin.wait(), reqwest::get(callback));
    assert_eq!(code(result), ErrorCode::IdentityVerificationFailed);
    assert_eq!(f.store.writes.load(Ordering::SeqCst), 0);
}

struct HostileMetadata;
#[async_trait]
impl HttpTransport for HostileMetadata {
    async fn request(
        &self,
        _url: &str,
        _form: Option<&[(String, String)]>,
    ) -> Result<HttpResponse> {
        let base = format!("https://login.microsoftonline.com/{TENANT}");
        Ok(output(
            200,
            serde_json::json!({
                "issuer":format!("{base}/v2.0"),"authorization_endpoint":format!("{base}/oauth2/v2.0/authorize"),
                "token_endpoint":format!("{base}/oauth2/v2.0/token"),"jwks_uri":"https://attacker.example/keys",
            }),
        ))
    }
}

#[tokio::test]
async fn discovery_cannot_redirect_credentials_or_identity_key_requests() {
    let f = Fixture::new();
    let deps = Arc::new(Dependencies {
        clock: f.clock.clone(),
        store: f.store.clone(),
        http: Arc::new(HostileMetadata),
        cli: f.cli.clone(),
    });
    let signin =
        MicrosoftOAuthSignIn::with_dependencies(f.oauth(), None, Duration::from_secs(1), deps)
            .unwrap();
    assert_eq!(code(signin.begin_browser().await), ErrorCode::IdentityVerificationFailed);
    assert_eq!(f.store.writes.load(Ordering::SeqCst), 0);
}

#[tokio::test(start_paused = true)]
async fn device_storage_failure_is_not_durable_signin_success() {
    let f = Fixture::new();
    *f.store.fail_write.lock().unwrap() = Some(ErrorCode::StorageDenied);
    let signin = f.signin(None);
    signin.begin_device().await.unwrap();
    assert_eq!(code(signin.wait().await), ErrorCode::StorageDenied);
    assert_eq!(f.store.writes.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn process_runner_missing_executable_and_bounded_output_are_redacted() {
    let f = Fixture::new();
    let runner = ProcessCliRunner { executable: Some(f.directory.path().join("missing-fixture")) };
    assert_eq!(code(runner.run(&[]).await), ErrorCode::CliUnavailable);
    let path = f.directory.path().join(if cfg!(windows) { "fixture.cmd" } else { "fixture" });
    let script = if cfg!(windows) {
        "@echo off\r\necho fixture-private-output\r\nexit /b 0\r\n"
    } else {
        "#!/bin/sh\nprintf '%s\\n' 'fixture-private-output'\n"
    };
    std::fs::write(&path, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let runner = ProcessCliRunner { executable: Some(path) };
    let out = runner.run(&["account".into(), "show".into()]).await.unwrap();
    assert!(out.success);
    assert_eq!(out.stdout.expose().trim(), "fixture-private-output");
}

#[test]
fn secret_store_rejects_non_sdk_entries_without_account_access() {
    use crate::OsCredentialStore;
    for key in [
        "copilot-cli/fixture",
        "auth-sdk:v1:short",
        "auth-sdk:v1:zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    ] {
        assert_eq!(code(OsCredentialStore.read(key)), ErrorCode::InvalidConfiguration);
        assert_eq!(
            code(OsCredentialStore.write(key, &Secret::new("fixture".into()))),
            ErrorCode::InvalidConfiguration
        );
        assert_eq!(code(OsCredentialStore.delete(key)), ErrorCode::InvalidConfiguration);
    }
}

#[test]
#[ignore = "Explicit isolated OS-store fixture; enable in native CI only"]
fn isolated_os_store_fixture() {
    use crate::OsCredentialStore;
    let directory = tempfile::tempdir().unwrap();
    let key = format!(
        "auth-sdk:v1:{}",
        config::hash(&["isolated-fixture", &directory.path().to_string_lossy()])
    );
    assert!(OsCredentialStore.read(&key).unwrap().is_none());
    OsCredentialStore.write(&key, &Secret::new("synthetic-refresh-fixture".into())).unwrap();
    let stored = OsCredentialStore.read(&key);
    let deleted = OsCredentialStore.delete(&key);
    assert_eq!(stored.unwrap().unwrap().expose(), "synthetic-refresh-fixture");
    deleted.unwrap();
    assert!(OsCredentialStore.read(&key).unwrap().is_none());
}

#[cfg(target_os = "linux")]
#[test]
fn linux_unavailable_store_is_an_explicit_failure() {
    let result = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--ignored", "--exact", "microsoft::tests::linux_unavailable_store_child"])
        .env("DBUS_SESSION_BUS_ADDRESS", "unix:path=/nonexistent/auth-sdk-fixture-bus")
        .output()
        .unwrap();
    assert!(result.status.success(), "isolated unavailable-store test failed");
}

#[cfg(target_os = "linux")]
#[test]
#[ignore = "Subprocess isolates DBus environment"]
fn linux_unavailable_store_child() {
    let key = format!("auth-sdk:v1:{}", config::hash(&["unavailable-fixture"]));
    assert_eq!(code(crate::OsCredentialStore.read(&key)), ErrorCode::StorageUnavailable);
}

#[tokio::test]
async fn competing_processes_coordinate_on_the_same_credential_lock() {
    let f = Fixture::new();
    let key = "cross-process-fixture";
    let lock = coordination::CredentialLock::acquire(f.directory.path(), key).await.unwrap();
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--ignored", "--exact", "microsoft::tests::coordination_child"])
        .env("AUTH_SDK_TEST_LOCK_DIR", f.directory.path())
        .output()
        .unwrap();
    assert!(output.status.success(), "competing-process lock check failed");
    drop(lock);
}

#[tokio::test]
#[ignore = "Subprocess checks OS lock contention, not process-local mutexes"]
async fn coordination_child() {
    let directory = std::env::var_os("AUTH_SDK_TEST_LOCK_DIR").unwrap();
    let result = tokio::time::timeout(
        Duration::from_millis(100),
        coordination::CredentialLock::acquire(
            std::path::Path::new(&directory),
            "cross-process-fixture",
        ),
    )
    .await;
    assert!(result.is_err());
}

struct RawCli(serde_json::Value);
#[async_trait]
impl CliRunner for RawCli {
    async fn run(&self, args: &[String]) -> Result<CliOutput> {
        let value = if args[1] == "show" {
            serde_json::json!({"id":SUBSCRIPTION,"tenantId":TENANT,
                "user":{"name":"fixture-account","type":"user"}})
        } else {
            self.0.clone()
        };
        Ok(CliOutput { success: true, stdout: Secret::new(value.to_string()) })
    }
}

#[tokio::test]
async fn cli_expiry_parsing_and_identity_validation_are_strict() {
    let f = Fixture::new();
    let mut value = serde_json::json!({
        "accessToken":"opaque","tokenType":"Bearer","tenant":TENANT,
        "subscription":SUBSCRIPTION,"expires_on":(NOW/1000+3600).to_string(),
    });
    let options = match f.options(Refresh::Auto, false).source {
        MicrosoftTokenSource::AzureCli(options) => options,
        _ => unreachable!(),
    };
    let token = cli::acquire(&RawCli(value.clone()), &options).await.unwrap();
    assert_eq!(token.expires_at, NOW + 3_600_000);
    for expiry in [
        serde_json::json!(-1),
        serde_json::json!("ambiguous-local-date"),
        serde_json::json!(u64::MAX),
        serde_json::Value::Null,
    ] {
        value["expires_on"] = expiry;
        assert_eq!(
            code(cli::acquire(&RawCli(value.clone()), &options).await),
            ErrorCode::InvalidTokenResponse
        );
    }
    value["expires_on"] = serde_json::json!(NOW / 1000 + 3600);
    value["tenant"] = SUBSCRIPTION.into();
    assert_eq!(
        code(cli::acquire(&RawCli(value.clone()), &options).await),
        ErrorCode::AccountMismatch
    );
}

#[tokio::test]
async fn cli_subscription_selection_does_not_mix_tenant_argument() {
    let fixture = Fixture::new();
    let provider = MicrosoftTokenProvider::with_dependencies(
        fixture.options(Refresh::Auto, false),
        fixture.deps.clone(),
    )
    .unwrap();
    let token = provider.get_token(false, &CancellationToken::new()).await.unwrap();
    assert_eq!(token.account.tenant, TENANT);
    assert_eq!(fixture.cli.calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn cancellation_kills_cli_descendants_before_they_can_publish() {
    let f = Fixture::new();
    let file = f.directory.path().join(if cfg!(windows) { "fixture.cmd" } else { "fixture" });
    let marker = f.directory.path().join("late-publication");
    let script = if cfg!(windows) {
        format!("@echo off\r\n\"%SystemRoot%\\System32\\ping.exe\" -n 3 127.0.0.1 >nul\r\necho late>\"{}\"\r\n",marker.display())
    } else {
        format!("#!/bin/sh\n/bin/sleep 1\nprintf late > '{}'\n", marker.display())
    };
    std::fs::write(&file, script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let runner = ProcessCliRunner { executable: Some(file) };
    let outcome = tokio::time::timeout(Duration::from_millis(100), runner.run(&[])).await;
    match outcome {
        Err(_) => {}
        Ok(Err(error)) => panic!("fixture CLI exited before cancellation: {:?}", error.code),
        Ok(Ok(_)) => panic!("fixture CLI completed before cancellation"),
    }
    tokio::time::sleep(Duration::from_millis(if cfg!(windows) { 2500 } else { 1200 })).await;
    assert!(!marker.exists());
}
