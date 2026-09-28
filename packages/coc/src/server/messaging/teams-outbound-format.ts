export const TEAMS_CHANNEL_PREFIX = 'AI: ';

export type TeamsOutboundSource = 'markdown' | 'html';

export function formatTeamsOutbound(text: string, _source: TeamsOutboundSource): string {
    return TEAMS_CHANNEL_PREFIX + text;
}
