import type { BotControlPresentation } from '@plusplusoneplusplus/coc-client';

const SOURCES = {
    teams: { label: 'Teams', controller: 'Teams bridge', host: 'teams.microsoft.com' },
    whatsapp: { label: 'WhatsApp', controller: 'WhatsApp bridge', host: 'web.whatsapp.com' },
};

/** Only consume the owning server's gated public projection, never private metadata or payloads. */
export function readBotControl(value: unknown): BotControlPresentation | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !('state' in value) || value.state !== 'active'
        || !('source' in value) || (value.source !== 'teams' && value.source !== 'whatsapp')
        || !('controllerLabel' in value) || value.controllerLabel !== SOURCES[value.source].controller
        || Object.keys(value).some(key => !['state', 'source', 'controllerLabel', 'externalThreadUrl'].includes(key))) {
        return undefined;
    }
    const control: BotControlPresentation = {
        state: 'active',
        source: value.source,
        controllerLabel: value.controllerLabel,
    };
    // Presence in the public projection conveys server authorization; syntax alone cannot do so.
    if ('externalThreadUrl' in value && typeof value.externalThreadUrl === 'string'
        && value.externalThreadUrl.length <= 2048 && !/[\s\\]/.test(value.externalThreadUrl)
        && URL.canParse(value.externalThreadUrl)) {
        const url = new URL(value.externalThreadUrl);
        if (url.protocol === 'https:' && url.hostname === SOURCES[control.source].host
            && !url.username && !url.password && !url.port && !url.hash) {
            control.externalThreadUrl = value.externalThreadUrl;
        }
    }
    return control;
}

export function botControlSourceLabel(control: BotControlPresentation): string {
    return SOURCES[control.source].label;
}
