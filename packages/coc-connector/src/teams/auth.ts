import { AuthError, MicrosoftOAuthSignIn, MicrosoftTokenProvider,
    type MicrosoftAccount, type MicrosoftOAuthOptions, type MicrosoftToken } from '@plusplusoneplusplus/coc-native';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, readFileSync, lstatSync } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { McpClient } from './mcp/mcp-client';

export interface TeamsOAuthCredentialOptions {
    dataDir: string;
    serverUrl: string;
    clientId?: string;
    scope?: string;
    mode?: 'mcp' | 'graph';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY_SCOPES = ['openid', 'profile', 'offline_access'];

export function extractTenantId(serverUrl: string): string | undefined {
    try {
        const segments = new URL(serverUrl).pathname.split('/');
        const index = segments.indexOf('tenants');
        const tenant = segments[index + 1];
        return index >= 0 && UUID.test(tenant ?? '') ? tenant.toLowerCase() : undefined;
    } catch { return undefined; }
}

async function secureDirectory(directory: string): Promise<void> {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(directory)).isDirectory()) throw new AuthError('StorageDenied');
    if (process.platform === 'win32') {
        const run = promisify(execFile);
        const { stdout } = await run('whoami.exe', ['/user', '/fo', 'csv', '/nh'],
            { windowsHide: true, timeout: 10_000 });
        const sid = stdout.match(/S-1-(?:\d+-)*\d+/)?.[0];
        if (!sid) throw new AuthError('StorageDenied');
        // Replace the ACL, including explicit grants on an existing directory.
        const script = `$p='${directory.replace(/'/g, "''")}';$sid='${sid}';` +
            '$ErrorActionPreference="Stop";' +
            '$acl=[System.Security.AccessControl.DirectorySecurity]::new();' +
            '$owner=[System.Security.Principal.SecurityIdentifier]::new($sid);' +
            '$acl.SetAccessRuleProtection($true,$false);' +
            '$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($owner,"FullControl","ContainerInherit,ObjectInherit","None","Allow");' +
            '$acl.AddAccessRule($rule);[System.IO.Directory]::SetAccessControl($p,$acl)';
        await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64')],
            { windowsHide: true, timeout: 10_000 });
    } else {
        const stat = await fs.stat(directory);
        if (process.getuid && stat.uid !== process.getuid()) throw new AuthError('StorageDenied');
        await fs.chmod(directory, 0o700);
    }
}

/** Native OAuth owns credentials and renewal; only verified identity is persisted here. */
export class TeamsOAuthCredential {
    private readonly oauth: MicrosoftOAuthOptions;
    private readonly directory: string;
    private readonly metadataPath: string;
    private readonly fingerprint: string;
    private readonly mode: 'mcp' | 'graph';
    private readonly serverUrl: string;
    private identity?: MicrosoftAccount;
    private signIn?: MicrosoftOAuthSignIn;
    private initialization?: Promise<void>;
    private completion?: Promise<void>;
    private lifetime = new AbortController();
    private generation = 0;
    private disposed = false;
    private status: 'unauthenticated' | 'authenticated' | 'error' = 'unauthenticated';
    private metadataError?: AuthError;

    constructor(options: TeamsOAuthCredentialOptions) {
        const tenant = extractTenantId(options.serverUrl);
        let url: URL;
        try { url = new URL(options.serverUrl); } catch { throw new AuthError('InvalidConfiguration'); }
        const clientId = options.clientId ?? 'aebc6443-996d-45c2-90f0-388ff96faa56';
        if (!tenant || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
            || !UUID.test(clientId) || !options.dataDir || !path.isAbsolute(options.dataDir)
            || (options.mode !== undefined && options.mode !== 'mcp' && options.mode !== 'graph')) {
            throw new AuthError('InvalidConfiguration');
        }
        this.mode = options.mode ?? 'mcp';
        this.serverUrl = options.serverUrl.replace(/\/$/, '');
        const resource = this.mode === 'graph' ? 'https://graph.microsoft.com' : this.serverUrl;
        const supplied = (options.scope ?? `${resource}/.default`).split(/\s+/).filter(Boolean);
        if (!supplied.some(scope => !IDENTITY_SCOPES.includes(scope))
            || supplied.some(scope => !IDENTITY_SCOPES.includes(scope) && !scope.startsWith(`${resource}/`))) {
            throw new AuthError('InvalidConfiguration');
        }
        const scopes = [...new Set([...IDENTITY_SCOPES, ...supplied])].sort();
        this.fingerprint = createHash('sha256').update(JSON.stringify({
            host: path.resolve(options.dataDir), serverUrl: this.serverUrl, clientId, tenant, scopes, mode: this.mode,
        })).digest('hex');
        this.directory = path.join(options.dataDir, 'teams-auth', this.fingerprint);
        this.metadataPath = path.join(this.directory, 'account.json');
        this.oauth = {
            namespace: `teams-${this.fingerprint}`, authority: `https://login.microsoftonline.com/${tenant}`,
            clientId, scopes, target: resource, resource, coordinationDirectory: this.directory,
        };
        // Startup status reads only bounded nonsecret metadata, never native credentials.
        try {
            const stat = lstatSync(this.metadataPath);
            if (!stat.isFile() || stat.size > 4096) throw new AuthError('StorageFailed');
            this.identity = this.readAccount(readFileSync(this.metadataPath, 'utf8'));
            this.status = 'authenticated';
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.metadataError = error instanceof AuthError ? error : new AuthError('StorageFailed');
                this.status = 'error';
            }
        }
    }

    get account(): { tenantId: string; objectId: string } | undefined {
        return this.identity ? { tenantId: this.identity.tenant, objectId: this.identity.id } : undefined;
    }

    getAccount(): { tenantId: string; objectId: string } | undefined { return this.account; }

    getStatus(): 'unauthenticated' | 'authenticated' | 'error' { return this.status; }

    private check(generation = this.generation): void {
        if (this.disposed) throw new AuthError('Disposed');
        if (generation !== this.generation) throw new AuthError('Cancelled');
    }

    private initialize(): Promise<void> {
        this.check();
        if (this.metadataError) return Promise.reject(this.metadataError);
        return this.initialization ??= (async () => {
            try {
                await secureDirectory(path.dirname(this.directory));
                await secureDirectory(this.directory);
                let raw: string;
                try { raw = await fs.readFile(this.metadataPath, 'utf8'); }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
                    throw new AuthError('StorageFailed');
                }
                this.check();
                this.identity = this.readAccount(raw);
                this.status = 'authenticated';
            } catch (error) {
                this.status = 'error';
                throw error instanceof AuthError ? error : new AuthError('StorageFailed');
            }
        })();
    }

    private readAccount(raw: string): MicrosoftAccount {
        if (Buffer.byteLength(raw) > 4096) throw new AuthError('StorageFailed');
        let metadata: { fingerprint: string; account: MicrosoftAccount };
        try { metadata = JSON.parse(raw); } catch { throw new AuthError('StorageFailed'); }
        if (!metadata || metadata.fingerprint !== this.fingerprint || !metadata.account
            || metadata.account.tenant !== extractTenantId(this.serverUrl) || !UUID.test(metadata.account.id)) {
            throw new AuthError('AccountMismatch');
        }
        return { tenant: metadata.account.tenant, id: metadata.account.id };
    }

    private makeProvider(account: MicrosoftAccount): MicrosoftTokenProvider {
        return new MicrosoftTokenProvider({ source: 'oauth', oauth: this.oauth, account,
            refresh: 'auto', timeoutMs: 30_000 });
    }

    async beginBrowser(): Promise<{ authorizationUrl: string }> {
        this.check();
        this.cancelSignIn();
        const generation = this.generation;
        await this.initialize();
        this.check(generation);
        await this.completion?.catch(() => {});
        this.check(generation);
        const signIn = this.signIn = new MicrosoftOAuthSignIn(this.oauth, this.identity, 120_000);
        try {
            const instructions = await signIn.beginBrowser();
            this.check(generation);
            if (!instructions.authorizationUrl) throw new AuthError('InvalidTokenResponse');
            return { authorizationUrl: instructions.authorizationUrl };
        } catch (error) {
            signIn.cancel();
            signIn.dispose();
            if (this.signIn === signIn) this.signIn = undefined;
            throw error instanceof AuthError ? error : new AuthError('IdentityVerificationFailed');
        }
    }

    wait(): Promise<void> {
        this.check();
        if (this.completion) return this.completion;
        const signIn = this.signIn;
        if (!signIn) return Promise.reject(new AuthError('LoginRequired'));
        const generation = this.generation;
        const signal = this.lifetime.signal;
        const task = (async () => {
            let candidate: MicrosoftTokenProvider | undefined;
            let published = false;
            let renamed = false;
            let staging: string | undefined;
            try {
                const result = await signIn.wait();
                candidate = this.makeProvider(result.account);
                this.check(generation);
                this.validateToken(result.token, result.account);
                if (this.mode === 'mcp') {
                    const client = new McpClient({ serverUrl: this.serverUrl, bearerToken: result.token.accessToken });
                    const budget = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
                    await client.initialize(budget);
                    const tools = await client.listTools(budget);
                    if (!Array.isArray(tools?.tools)) throw new AuthError('AccessDenied');
                }
                this.check(generation);
                this.validateToken(result.token, result.account);
                staging = `${this.metadataPath}.${randomUUID()}`;
                await fs.writeFile(staging, JSON.stringify({ fingerprint: this.fingerprint, account: result.account }),
                    { mode: 0o600, flag: 'wx' });
                this.check(generation);
                await fs.rename(staging, this.metadataPath);
                renamed = true;
                this.check(generation);
                this.identity = result.account;
                this.status = 'authenticated';
                published = true;
            } catch (error) {
                if (generation === this.generation && !this.disposed) this.status = 'error';
                throw error instanceof AuthError ? error : new AuthError('IdentityVerificationFailed');
            } finally {
                let cleanupFailed = false;
                try {
                    if (!published && candidate) {
                        await candidate.deleteCredentials();
                    }
                } catch { cleanupFailed = true; }
                finally { candidate?.dispose(); }
                try {
                    if (renamed && !published) await fs.rm(this.metadataPath, { force: true });
                    if (staging) await fs.rm(staging, { force: true });
                } catch { cleanupFailed = true; }
                finally {
                    signIn.dispose();
                    if (this.signIn === signIn) this.signIn = undefined;
                }
                if (cleanupFailed) throw new AuthError('StorageFailed');
            }
        })();
        this.completion = task;
        void task.finally(() => { if (this.completion === task) this.completion = undefined; }).catch(() => {});
        return task;
    }

    private validateToken(token: MicrosoftToken, account: MicrosoftAccount): void {
        if (token.source !== 'oauth' || token.target !== this.oauth.target || !token.accessToken
            || !UUID.test(account.id)
            || account.tenant !== extractTenantId(this.serverUrl)
            || token.account.id !== account.id || token.account.tenant !== account.tenant) {
            throw new AuthError('AccountMismatch');
        }
        if (!Number.isFinite(token.expiresAt)) throw new AuthError('InvalidTokenResponse');
        if (token.expiresAt <= Date.now()) throw new AuthError('TokenExpired');
    }

    async getToken(signal?: AbortSignal, forceRefresh = false): Promise<string> {
        return (await this.getTokenSnapshot(signal, forceRefresh)).accessToken;
    }

    async getTokenSnapshot(signal?: AbortSignal, forceRefresh = false): Promise<MicrosoftToken> {
        signal?.throwIfAborted();
        const generation = this.generation;
        await this.initialize();
        this.check(generation);
        if (!this.identity) throw new AuthError('LoginRequired');
        const combined = AbortSignal.any([this.lifetime.signal, ...(signal ? [signal] : [])]);
        combined.throwIfAborted();
        const account = this.identity;
        const provider = this.makeProvider(account);
        const abort = () => {
            provider.cancelOutstanding();
            provider.dispose();
        };
        combined.addEventListener('abort', abort, { once: true });
        try {
            const token = await provider.getToken({ forceRefresh });
            this.check(generation);
            combined.throwIfAborted();
            this.validateToken(token, account);
            this.status = 'authenticated';
            return token;
        } catch (error) {
            if (generation === this.generation && !combined.aborted) this.status = 'error';
            if (this.disposed) throw new AuthError('Disposed');
            if (combined.aborted && !this.disposed) throw new AuthError('Cancelled');
            throw error instanceof AuthError ? error : new AuthError('InvalidTokenResponse');
        } finally {
            combined.removeEventListener('abort', abort);
            provider.dispose();
        }
    }

    async refreshStatus(): Promise<'unauthenticated' | 'authenticated' | 'error'> {
        try { await this.getToken(); } catch { /* The public status never exposes provider errors. */ }
        return this.status;
    }

    cancelSignIn(): void {
        this.generation++;
        this.lifetime.abort();
        this.lifetime = new AbortController();
        this.signIn?.cancel();
        this.signIn?.dispose();
        this.signIn = undefined;
    }

    async deleteCredentials(): Promise<void> {
        this.check();
        this.cancelSignIn();
        const generation = this.generation;
        await this.initialize();
        this.check(generation);
        await this.completion?.catch(() => {});
        this.check(generation);
        const provider = this.identity && this.makeProvider(this.identity);
        try {
            await provider?.deleteCredentials();
            await fs.rm(this.metadataPath, { force: true });
            this.identity = undefined;
            this.status = 'unauthenticated';
        } catch { this.status = 'error'; throw new AuthError('StorageFailed'); }
        finally { provider?.dispose(); }
    }

    dispose(): void {
        this.cancelSignIn();
        this.disposed = true;
        this.status = 'unauthenticated';
    }
}
