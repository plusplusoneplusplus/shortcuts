import { AuthError, MicrosoftTokenProvider } from '@plusplusoneplusplus/coc-native';

export const TEAMS_AZURE_CLI_TIMEOUT_MS = 30_000;

/** One source-pinned Azure CLI provider per connection and resource. */
export class TeamsAzureCliCredential {
    private provider?: MicrosoftTokenProvider;
    private disposed = false;
    private refreshRequired = false;
    private generation = 0;

    constructor(private readonly resource: string) {}

    async get(signal: AbortSignal, forceRefresh = false): Promise<string> {
        signal.throwIfAborted();
        if (this.disposed) throw new AuthError('Disposed');
        const provider = this.provider ??= new MicrosoftTokenProvider({
            source: 'azure-cli', refresh: 'auto', timeoutMs: TEAMS_AZURE_CLI_TIMEOUT_MS,
            azureCli: {
                selection: 'active-account', namespace: 'teams', resource: this.resource,
            },
        });
        let abort = () => {};
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => {
                provider.cancelOutstanding();
                reject(new AuthError('Cancelled'));
            };
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
        });
        try {
            const generation = this.generation;
            const token = await Promise.race([
                provider.getToken({ forceRefresh: forceRefresh || this.refreshRequired }), cancelled,
            ]);
            signal.throwIfAborted();
            if (this.disposed) throw new AuthError('Disposed');
            if (generation === this.generation) this.refreshRequired = false;
            return token.accessToken;
        } finally {
            signal.removeEventListener('abort', abort);
        }
    }

    clear(): void {
        this.generation++;
        this.refreshRequired = true;
    }

    dispose(): void {
        this.disposed = true;
        this.provider?.dispose();
        this.provider = undefined;
    }
}
