import type { BotControlMetadata, BotControlSource } from '@plusplusoneplusplus/forge/ai';

const CONTROLLERS: Record<BotControlSource, { key: string; label: string; threadHost: string }> = {
    teams: { key: 'teams-bridge', label: 'Teams bridge', threadHost: 'teams.microsoft.com' },
    whatsapp: { key: 'whatsapp-bridge', label: 'WhatsApp bridge', threadHost: 'web.whatsapp.com' },
};

/** Call only from authoritative bridge admission/binding paths, never a public request body. */
export function createBotControlMetadata(source: BotControlSource): BotControlMetadata {
    const controller = CONTROLLERS[source];
    return {
        state: 'active',
        source,
        controllerKey: controller.key,
        controllerLabel: controller.label,
    };
}

/** Authorization must verify the URL against the owning workspace's live binding. */
export type AuthorizeBotThreadUrl = (source: BotControlSource, url: string) => boolean;

export class BotControlValidationError extends Error {}

export function validateBotControlMetadata(
    value: unknown,
    authorizeThreadUrl?: AuthorizeBotThreadUrl,
): BotControlMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !('state' in value) || value.state !== 'active'
        || !('source' in value) || (value.source !== 'teams' && value.source !== 'whatsapp')
        || !('controllerKey' in value) || !('controllerLabel' in value)
        || Object.keys(value).some(key => ![
            'state', 'source', 'controllerKey', 'controllerLabel', 'externalThreadUrl',
        ].includes(key))) {
        throw new BotControlValidationError('Invalid bot control metadata');
    }

    const controller = CONTROLLERS[value.source];
    // Fixed integration identities keep account, sender, and routing data out of presentation metadata.
    if (value.controllerKey !== controller.key || value.controllerLabel !== controller.label) {
        throw new BotControlValidationError('Invalid bot control controller identity');
    }
    const metadata = createBotControlMetadata(value.source);
    if ('externalThreadUrl' in value && value.externalThreadUrl !== undefined) {
        const url = value.externalThreadUrl;
        if (typeof url !== 'string' || url.length > 2048 || /[\s\\]/.test(url) || !URL.canParse(url)) {
            throw new BotControlValidationError('Invalid bot control thread URL');
        }
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.hostname !== controller.threadHost
            || parsed.username || parsed.password || parsed.port || parsed.hash) {
            throw new BotControlValidationError('Invalid bot control thread URL');
        }
        if (!authorizeThreadUrl || !authorizeThreadUrl(value.source, url)) {
            throw new BotControlValidationError('Unauthorized bot control thread URL');
        }
        metadata.externalThreadUrl = url;
    }
    return metadata;
}
