use super::{
    cli, oauth, AzureCliSelection, CliRunner, HttpTransport, MicrosoftTokenSource,
    ProcessCliRunner, ProviderOptions, ReqwestTransport,
};
use crate::{
    contracts::{bounded, fail, Lifetime},
    Clock, CredentialStore, ErrorCode, OsCredentialStore, Refresh, Result, SystemClock, Token,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock, Weak},
};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::sync::CancellationToken;

/// Trusted injection for standalone Rust applications/tests. Production N-API uses defaults.
pub struct Dependencies {
    pub clock: Arc<dyn Clock>,
    pub store: Arc<dyn CredentialStore>,
    pub http: Arc<dyn HttpTransport>,
    pub cli: Arc<dyn CliRunner>,
}

impl Default for Dependencies {
    fn default() -> Self {
        Self {
            clock: Arc::new(SystemClock),
            store: Arc::new(OsCredentialStore),
            http: Arc::new(ReqwestTransport),
            cli: Arc::new(ProcessCliRunner::default()),
        }
    }
}

pub(crate) fn default_dependencies() -> Arc<Dependencies> {
    static DEFAULT: OnceLock<Arc<Dependencies>> = OnceLock::new();
    DEFAULT.get_or_init(|| Arc::new(Dependencies::default())).clone()
}

struct Acquisition {
    generation: u64,
    result: Option<Result<Token>>,
}
struct Shared {
    state: AsyncMutex<Acquisition>,
    generation: std::sync::atomic::AtomicU64,
}

fn shared(key: String) -> Arc<Shared> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Weak<Shared>>>> = OnceLock::new();
    let mut registry =
        REGISTRY.get_or_init(Mutex::default).lock().unwrap_or_else(|e| e.into_inner());
    registry.retain(|_, value| value.strong_count() > 0);
    if let Some(state) = registry.get(&key).and_then(Weak::upgrade) {
        return state;
    }
    let value = Arc::new(Shared {
        state: AsyncMutex::new(Acquisition { generation: 0, result: None }),
        generation: std::sync::atomic::AtomicU64::new(0),
    });
    registry.insert(key, Arc::downgrade(&value));
    value
}

struct Instance {
    acquired: bool,
    cache: Option<Token>,
    selection: Option<super::AzureCliOptions>,
}

pub struct MicrosoftTokenProvider {
    options: ProviderOptions,
    dependencies: Arc<Dependencies>,
    life: Arc<Lifetime>,
    instance: AsyncMutex<Instance>,
    shared: Arc<Shared>,
}

impl MicrosoftTokenProvider {
    pub fn new(options: ProviderOptions) -> Result<Self> {
        Self::with_dependencies(options, default_dependencies())
    }

    pub fn with_dependencies(
        options: ProviderOptions,
        dependencies: Arc<Dependencies>,
    ) -> Result<Self> {
        options.validate()?;
        // Injectable transports/stores have their own trust domain, even with identical configuration.
        let key = format!("{}:{:p}", options.key(), Arc::as_ptr(&dependencies));
        let active_cli = matches!(&options.source, MicrosoftTokenSource::AzureCli(o)
            if matches!(o.selection, AzureCliSelection::ActiveAccount));
        // Production dependencies are shared across providers by the caller/N-API.
        Ok(Self {
            options,
            dependencies,
            life: Lifetime::new(),
            instance: AsyncMutex::new(Instance { acquired: false, cache: None, selection: None }),
            // Active identity is resolved lazily. Never share tokens before its trust domain is pinned.
            shared: if active_cli {
                Arc::new(Shared {
                    state: AsyncMutex::new(Acquisition { generation: 0, result: None }),
                    generation: std::sync::atomic::AtomicU64::new(0),
                })
            } else {
                shared(key)
            },
        })
    }

    pub async fn get_token(
        &self,
        force_refresh: bool,
        cancel: &CancellationToken,
    ) -> Result<Token> {
        let observed = self.shared.generation.load(std::sync::atomic::Ordering::Acquire);
        let deadline = tokio::time::Instant::now() + self.options.timeout;
        let result = bounded(&self.life, cancel, self.options.timeout, async {
            let mut instance = self.instance.lock().await;
            if force_refresh && self.options.refresh == Refresh::Never {
                return fail(ErrorCode::RefreshDisabled);
            }
            if let MicrosoftTokenSource::AzureCli(options) = &self.options.source {
                if matches!(options.selection, AzureCliSelection::ActiveAccount) {
                    let selection =
                        cli::active_selection(self.dependencies.cli.as_ref(), options).await?;
                    if instance
                        .selection
                        .as_ref()
                        .is_some_and(|pinned| !cli::same_selection(pinned, &selection))
                    {
                        instance.cache = None;
                        self.shared.state.lock().await.result = None;
                        return fail(ErrorCode::AccountMismatch);
                    }
                    instance.selection = Some(selection);
                }
            }
            if !force_refresh {
                if let Some(token) = &instance.cache {
                    if token
                        .valid(self.dependencies.clock.now_ms(), self.options.expiry_margin_seconds)
                    {
                        return Ok(token.clone());
                    }
                }
            }
            if instance.acquired && self.options.refresh == Refresh::Never {
                return fail(ErrorCode::RefreshDisabled);
            }
            let mut shared = self.shared.state.lock().await;
            // Waiters for one operation share both success and failure, including forced refresh.
            if shared.generation != observed {
                if let Some(result) = &shared.result {
                    match result {
                        Ok(token)
                            if token.valid(
                                self.dependencies.clock.now_ms(),
                                self.options.expiry_margin_seconds,
                            ) =>
                        {
                            let token = token.clone();
                            self.life.publish(|| {
                                instance.cache = Some(token.clone());
                                instance.acquired = true;
                                Ok(())
                            })?;
                            return Ok(token);
                        }
                        Err(error) => return Err(error.clone()),
                        _ => {}
                    }
                }
            }
            if !force_refresh {
                if let Some(Ok(token)) = &shared.result {
                    if token
                        .valid(self.dependencies.clock.now_ms(), self.options.expiry_margin_seconds)
                    {
                        let token = token.clone();
                        self.life.publish(|| {
                            instance.cache = Some(token.clone());
                            instance.acquired = true;
                            Ok(())
                        })?;
                        return Ok(token);
                    }
                }
            }
            let result = match &self.options.source {
                MicrosoftTokenSource::AzureCli(options)
                    if matches!(options.selection, AzureCliSelection::Explicit { .. }) =>
                {
                    cli::acquire(self.dependencies.cli.as_ref(), options).await
                }
                MicrosoftTokenSource::AzureCli(options) => {
                    async {
                        let pinned = instance.selection.as_ref().ok_or_else(|| {
                            crate::AuthError::new(ErrorCode::InvalidConfiguration)
                        })?;
                        let token = cli::acquire(self.dependencies.cli.as_ref(), pinned).await?;
                        let selection =
                            cli::active_selection(self.dependencies.cli.as_ref(), options).await?;
                        if !cli::same_selection(pinned, &selection) {
                            return fail(ErrorCode::AccountMismatch);
                        }
                        Ok(token)
                    }
                    .await
                }
                MicrosoftTokenSource::OAuth { options, account } => {
                    oauth::acquire(
                        &self.dependencies,
                        options,
                        account,
                        &self.life,
                        cancel,
                        deadline,
                    )
                    .await
                }
            }
            .and_then(|token| {
                crate::contracts::checkpoint(cancel, deadline)?;
                if !token
                    .valid(self.dependencies.clock.now_ms(), self.options.expiry_margin_seconds)
                {
                    fail(ErrorCode::TokenExpired)
                } else {
                    Ok(token)
                }
            });
            self.life.publish(|| {
                crate::contracts::checkpoint(cancel, deadline)?;
                shared.generation += 1;
                shared.result = Some(result.clone());
                self.shared
                    .generation
                    .store(shared.generation, std::sync::atomic::Ordering::Release);
                if let Ok(token) = &result {
                    instance.acquired = true;
                    instance.cache = Some(token.clone());
                }
                Ok(())
            })?;
            result
        })
        .await;
        if self.life.check().is_err() {
            self.instance.lock().await.cache = None;
        }
        result
    }

    pub async fn invalidate(&self) -> Result<()> {
        self.life.check()?;
        let mut instance = self.instance.lock().await;
        // Never's acquired bit is irreversible. Invalidation cannot create a new initial attempt.
        let mut shared = self.shared.state.lock().await;
        self.life.publish(|| {
            instance.cache = None;
            shared.result = None;
            Ok(())
        })
    }

    pub async fn delete_credentials(&self, cancel: &CancellationToken) -> Result<()> {
        bounded(&self.life, cancel, self.options.timeout, async {
            match &self.options.source {
                MicrosoftTokenSource::OAuth { options, account } => {
                    let key = options.credential_key(account);
                    let _lock = super::coordination::CredentialLock::acquire(
                        &options.coordination_dir,
                        &key,
                    )
                    .await?;
                    self.life.publish(|| self.dependencies.store.delete(&key))?;
                }
                MicrosoftTokenSource::AzureCli(_) => return fail(ErrorCode::InvalidConfiguration),
            }
            self.invalidate().await
        })
        .await
    }

    pub fn dispose(&self) {
        self.life.dispose();
        if let Ok(mut instance) = self.instance.try_lock() {
            instance.cache = None;
        }
        if let Ok(mut shared) = self.shared.state.try_lock() {
            shared.result = None;
        }
    }

    pub fn ensure_active(&self) -> Result<()> {
        self.life.check()
    }
}

impl Drop for MicrosoftTokenProvider {
    fn drop(&mut self) {
        self.dispose();
    }
}
