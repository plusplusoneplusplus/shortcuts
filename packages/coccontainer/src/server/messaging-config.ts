/**
 * Messaging config persistence.
 *
 * Writes Teams messaging settings into the container's `config.yaml` so they
 * survive restarts even when the live bridge is not running. File-system and
 * YAML access are injectable so persistence can be tested against a temp dir
 * (or in-memory fakes) without a full container server.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as jsYaml from 'js-yaml';

/** Teams config fields that can be persisted to `config.yaml`. */
export interface TeamsConfigPatch {
    enabled?: boolean;
    botName?: string;
    channelId?: string;
    teamName?: string;
    channelName?: string;
    mode?: 'graph' | 'mcp';
    mcpServerUrl?: string;
}

/** Minimal synchronous file-system surface used for config persistence. */
export type MessagingConfigFs = Pick<typeof fs, 'readFileSync' | 'writeFileSync'>;
/** Minimal YAML codec surface (load/dump). */
export type YamlCodec = Pick<typeof jsYaml, 'load' | 'dump'>;

export class MessagingConfigService {
    constructor(
        private readonly dataDir: string,
        private readonly fsImpl: MessagingConfigFs = fs,
        private readonly yaml: YamlCodec = jsYaml,
    ) {}

    private get configPath(): string {
        return path.join(this.dataDir, 'config.yaml');
    }

    private readDoc(): Record<string, any> {
        try {
            return (this.yaml.load(this.fsImpl.readFileSync(this.configPath, 'utf8')) as Record<string, any>) ?? {};
        } catch {
            return {};
        }
    }

    private writeTeams(mutate: (teams: Record<string, any>) => void): void {
        const doc = this.readDoc();
        if (!doc.messaging) doc.messaging = {};
        if (!doc.messaging.teams) doc.messaging.teams = {};
        mutate(doc.messaging.teams);
        this.fsImpl.writeFileSync(this.configPath, this.yaml.dump(doc), 'utf8');
    }

    /** Persist the provided Teams config fields (only defined fields are written). */
    saveTeamsConfig(patch: TeamsConfigPatch): void {
        this.writeTeams((teams) => {
            if (patch.enabled !== undefined) teams.enabled = patch.enabled;
            if (patch.botName !== undefined) teams.botName = patch.botName;
            if (patch.channelId !== undefined) teams.channelId = patch.channelId;
            if (patch.teamName !== undefined) teams.teamName = patch.teamName;
            if (patch.channelName !== undefined) teams.channelName = patch.channelName;
            if (patch.mode !== undefined) teams.mode = patch.mode;
        });
    }

    /** Mark Teams as enabled and record the MCP server URL (used after a successful login). */
    enableTeams(mcpServerUrl: string): void {
        this.writeTeams((teams) => {
            teams.enabled = true;
            teams.mcpServerUrl = mcpServerUrl;
        });
    }
}
