/**
 * Admin Config Field Registry Tests
 *
 * Verifies that ADMIN_CONFIG_FIELDS covers every expected key, that validators
 * accept valid values and reject invalid ones, and that apply() correctly
 * mutates a CLIConfig object.
 */

import { describe, it, expect } from 'vitest';
import { ADMIN_CONFIG_FIELDS, ADMIN_EDITABLE_KEYS, getAdminFieldMetadata } from '../../src/server/admin/admin-config-fields';
import type { AdminConfigFieldSpec } from '../../src/server/admin/admin-config-fields';
import type { CLIConfig } from '../../src/config';

// ── helpers ──────────────────────────────────────────────────────────────────

function fieldFor(key: string): AdminConfigFieldSpec {
    const f = ADMIN_CONFIG_FIELDS.find(f => f.key === key);
    if (!f) throw new Error(`No field registered for key: ${key}`);
    return f;
}

// ── registry shape ────────────────────────────────────────────────────────────

describe('ADMIN_EDITABLE_KEYS', () => {
    it('contains no duplicate keys', () => {
        const seen = new Set<string>();
        for (const k of ADMIN_EDITABLE_KEYS) {
            expect(seen.has(k), `duplicate key: ${k}`).toBe(false);
            seen.add(k);
        }
    });

    it('contains all expected keys', () => {
        const expected = [
            'model', 'parallel', 'timeout', 'output',
            'showReportIntent', 'toolCompactness', 'taskCardDensity', 'groupSingleLineMessages',
            'serve.serverName',
            'chat.followUpSuggestions.enabled', 'chat.followUpSuggestions.count',
            'chat.askUser.enabled',
            'terminal.enabled', 'notes.enabled', 'myWork.enabled', 'myLife.enabled',
            'scratchpad.enabled', 'scratchpad.layout',
            'workflows.enabled', 'pullRequests.enabled', 'pullRequests.autoClassifyTeam', 'servers.enabled',
            'ralph.enabled', 'forEach.enabled', 'vimNavigation.enabled', 'loops.enabled', 'dreams.enabled',
            'dreams.idleCheckIntervalMs',
            'excalidraw.enabled',
            'mcpOauth.enabled', 'mcpOauth.autoRefresh.enabled',
            'codex.enabled', 'claude.enabled',
            'defaultProvider',
            'agentProviderRouting.auto',
            'features.gitCrossCloneCherryPick',
            'features.sessionContextAttachments',
            'features.ralphMultiAgentGrill',
            'features.commitChatLens',
            'features.commitChatLensDormantMode',
            'features.autoAgentProviderRouting',
            'workItems.hierarchy.enabled',
            'workItems.sync.enabled',
            'workItems.aiAuthoring.enabled',
            'workItems.workflow.enabled',
            'effortLevels.enabled',
        ];
        for (const k of expected) {
            expect(ADMIN_EDITABLE_KEYS).toContain(k);
        }
    });
});

// ── validate() ────────────────────────────────────────────────────────────────

describe('validate()', () => {
    describe('model', () => {
        it('accepts non-empty string', () => {
            expect(fieldFor('model').validate('claude-opus')).toBeUndefined();
        });
        it('rejects empty string', () => {
            expect(fieldFor('model').validate('')).toMatch(/non-empty/);
        });
        it('rejects non-string', () => {
            expect(fieldFor('model').validate(42)).toMatch(/non-empty/);
        });
    });

    describe('parallel', () => {
        it('accepts positive number', () => {
            expect(fieldFor('parallel').validate(4)).toBeUndefined();
        });
        it('rejects zero', () => {
            expect(fieldFor('parallel').validate(0)).toMatch(/greater than 0/);
        });
        it('rejects negative', () => {
            expect(fieldFor('parallel').validate(-1)).toMatch(/greater than 0/);
        });
        it('rejects string', () => {
            expect(fieldFor('parallel').validate('4')).toMatch(/greater than 0/);
        });
    });

    describe('timeout', () => {
        it('accepts positive number', () => {
            expect(fieldFor('timeout').validate(30)).toBeUndefined();
        });
        it('accepts null (to clear)', () => {
            expect(fieldFor('timeout').validate(null)).toBeUndefined();
        });
        it('rejects zero', () => {
            expect(fieldFor('timeout').validate(0)).toMatch(/greater than 0/);
        });
        it('rejects string', () => {
            expect(fieldFor('timeout').validate('30')).toMatch(/greater than 0/);
        });
    });

    describe('output', () => {
        const valid = ['table', 'json', 'csv', 'markdown'];
        for (const v of valid) {
            it(`accepts "${v}"`, () => {
                expect(fieldFor('output').validate(v)).toBeUndefined();
            });
        }
        it('rejects unknown value', () => {
            expect(fieldFor('output').validate('xml')).toMatch(/one of/);
        });
    });

    describe('toolCompactness', () => {
        for (const v of [0, 1, 2, 3]) {
            it(`accepts ${v}`, () => {
                expect(fieldFor('toolCompactness').validate(v)).toBeUndefined();
            });
        }
        it('rejects 4', () => {
            expect(fieldFor('toolCompactness').validate(4)).toMatch(/0, 1, 2, or 3/);
        });
        it('rejects float', () => {
            expect(fieldFor('toolCompactness').validate(1.5)).toMatch(/0, 1, 2, or 3/);
        });
    });

    describe('taskCardDensity', () => {
        it('accepts "compact"', () => {
            expect(fieldFor('taskCardDensity').validate('compact')).toBeUndefined();
        });
        it('accepts "dense"', () => {
            expect(fieldFor('taskCardDensity').validate('dense')).toBeUndefined();
        });
        it('rejects other strings', () => {
            expect(fieldFor('taskCardDensity').validate('sparse')).toMatch(/compact.*dense/);
        });
    });

    describe('serve.serverName', () => {
        it('accepts short string', () => {
            expect(fieldFor('serve.serverName').validate('my-server')).toBeUndefined();
        });
        it('accepts null', () => {
            expect(fieldFor('serve.serverName').validate(null)).toBeUndefined();
        });
        it('accepts string of exactly 64 chars', () => {
            expect(fieldFor('serve.serverName').validate('a'.repeat(64))).toBeUndefined();
        });
        it('rejects string of 65 chars', () => {
            expect(fieldFor('serve.serverName').validate('a'.repeat(65))).toMatch(/64 characters/);
        });
    });

    describe('chat.followUpSuggestions.count', () => {
        it('accepts 1', () => {
            expect(fieldFor('chat.followUpSuggestions.count').validate(1)).toBeUndefined();
        });
        it('accepts 5', () => {
            expect(fieldFor('chat.followUpSuggestions.count').validate(5)).toBeUndefined();
        });
        it('rejects 0', () => {
            expect(fieldFor('chat.followUpSuggestions.count').validate(0)).toMatch(/1 and 5/);
        });
        it('rejects 6', () => {
            expect(fieldFor('chat.followUpSuggestions.count').validate(6)).toMatch(/1 and 5/);
        });
        it('rejects float', () => {
            expect(fieldFor('chat.followUpSuggestions.count').validate(2.5)).toMatch(/1 and 5/);
        });
    });

    describe('dreams.idleCheckIntervalMs', () => {
        it('accepts a positive integer millisecond interval', () => {
            expect(fieldFor('dreams.idleCheckIntervalMs').validate(300_000)).toBeUndefined();
        });
        it('rejects zero', () => {
            expect(fieldFor('dreams.idleCheckIntervalMs').validate(0)).toMatch(/positive integer/);
        });
        it('rejects non-integers', () => {
            expect(fieldFor('dreams.idleCheckIntervalMs').validate(1.5)).toMatch(/positive integer/);
        });
    });

    describe('scratchpad.layout', () => {
        it('accepts "horizontal"', () => {
            expect(fieldFor('scratchpad.layout').validate('horizontal')).toBeUndefined();
        });
        it('accepts "vertical"', () => {
            expect(fieldFor('scratchpad.layout').validate('vertical')).toBeUndefined();
        });
        it('rejects other strings', () => {
            expect(fieldFor('scratchpad.layout').validate('diagonal')).toMatch(/horizontal.*vertical/);
        });
    });

    describe('features.commitChatLensDormantMode validation', () => {
        it('accepts ghost', () => {
            expect(fieldFor('features.commitChatLensDormantMode').validate('ghost')).toBeUndefined();
        });
        it('accepts pill', () => {
            expect(fieldFor('features.commitChatLensDormantMode').validate('pill')).toBeUndefined();
        });
        it('rejects unknown string values', () => {
            expect(fieldFor('features.commitChatLensDormantMode').validate('frost')).toBeDefined();
        });
        it('rejects non-string values', () => {
            expect(fieldFor('features.commitChatLensDormantMode').validate(true)).toBeDefined();
        });
    });

    describe('defaultProvider', () => {
        it('accepts "copilot"', () => {
            expect(fieldFor('defaultProvider').validate('copilot')).toBeUndefined();
        });
        it('accepts "codex"', () => {
            expect(fieldFor('defaultProvider').validate('codex')).toBeUndefined();
        });
        it('accepts "claude"', () => {
            expect(fieldFor('defaultProvider').validate('claude')).toBeUndefined();
        });
        it('rejects other strings', () => {
            expect(fieldFor('defaultProvider').validate('unknown')).toMatch(/copilot.*codex.*claude/);
        });
        it('rejects non-string', () => {
            expect(fieldFor('defaultProvider').validate(true)).toMatch(/copilot.*codex.*claude/);
        });
    });

    describe('agentProviderRouting.auto', () => {
        it('accepts a valid auto routing profile', () => {
            expect(fieldFor('agentProviderRouting.auto').validate({
                rules: [
                    {
                        provider: 'claude',
                        enabled: true,
                        minimumRemainingPercent: 33,
                        weeklyGuard: { enabled: true, minimumRemainingPercent: 33 },
                    },
                ],
                fallbackProvider: 'copilot',
            })).toBeUndefined();
        });

        it('rejects invalid rule provider values', () => {
            expect(fieldFor('agentProviderRouting.auto').validate({
                rules: [{ provider: 'openai' }],
            })).toMatch(/provider must be one of/);
        });

        it('rejects invalid threshold values', () => {
            expect(fieldFor('agentProviderRouting.auto').validate({
                rules: [{ provider: 'copilot', minimumRemainingPercent: 101 }],
            })).toMatch(/between 0 and 100/);
        });

        it('rejects invalid weekly guard threshold values', () => {
            expect(fieldFor('agentProviderRouting.auto').validate({
                rules: [{ provider: 'copilot', weeklyGuard: { minimumRemainingPercent: -1 } }],
            })).toMatch(/between 0 and 100/);
        });
    });

    // All plain boolean fields
    const booleanFields = [
        'showReportIntent', 'groupSingleLineMessages',
        'chat.followUpSuggestions.enabled', 'chat.askUser.enabled',
        'terminal.enabled', 'notes.enabled', 'myWork.enabled', 'myLife.enabled',
        'scratchpad.enabled', 'workflows.enabled', 'pullRequests.enabled', 'pullRequests.autoClassifyTeam',
        'servers.enabled', 'ralph.enabled', 'forEach.enabled', 'vimNavigation.enabled', 'loops.enabled', 'dreams.enabled',
        'excalidraw.enabled',
        'mcpOauth.enabled',
        'mcpOauth.autoRefresh.enabled',
        'codex.enabled',
        'claude.enabled',
        'features.gitCrossCloneCherryPick',
        'features.sessionContextAttachments',
        'features.ralphMultiAgentGrill',
        'features.commitChatLens',
        'features.autoAgentProviderRouting',
        'workItems.hierarchy.enabled',
        'workItems.sync.enabled',
        'workItems.aiAuthoring.enabled',
        'workItems.workflow.enabled',
        'effortLevels.enabled',
    ];

    for (const key of booleanFields) {
        describe(key, () => {
            it('accepts true', () => {
                expect(fieldFor(key).validate(true)).toBeUndefined();
            });
            it('accepts false', () => {
                expect(fieldFor(key).validate(false)).toBeUndefined();
            });
            it('rejects non-boolean', () => {
                expect(fieldFor(key).validate('true')).toMatch(/boolean/);
            });
        });
    }
});

// ── apply() ───────────────────────────────────────────────────────────────────

describe('apply()', () => {
    it('sets model on CLIConfig', () => {
        const cfg: CLIConfig = {};
        fieldFor('model').apply(cfg, 'claude-3');
        expect(cfg.model).toBe('claude-3');
    });

    it('sets parallel on CLIConfig', () => {
        const cfg: CLIConfig = {};
        fieldFor('parallel').apply(cfg, 8);
        expect(cfg.parallel).toBe(8);
    });

    it('sets timeout on CLIConfig', () => {
        const cfg: CLIConfig = {};
        fieldFor('timeout').apply(cfg, 60);
        expect(cfg.timeout).toBe(60);
    });

    it('deletes timeout when null', () => {
        const cfg: CLIConfig = { timeout: 30 };
        fieldFor('timeout').apply(cfg, null);
        expect(cfg.timeout).toBeUndefined();
    });

    it('sets output on CLIConfig', () => {
        const cfg: CLIConfig = {};
        fieldFor('output').apply(cfg, 'json');
        expect(cfg.output).toBe('json');
    });

    it('sets showReportIntent', () => {
        const cfg: CLIConfig = {};
        fieldFor('showReportIntent').apply(cfg, true);
        expect(cfg.showReportIntent).toBe(true);
    });

    it('sets toolCompactness', () => {
        const cfg: CLIConfig = {};
        fieldFor('toolCompactness').apply(cfg, 2);
        expect(cfg.toolCompactness).toBe(2);
    });

    it('sets taskCardDensity', () => {
        const cfg: CLIConfig = {};
        fieldFor('taskCardDensity').apply(cfg, 'compact');
        expect(cfg.taskCardDensity).toBe('compact');
    });

    it('sets groupSingleLineMessages', () => {
        const cfg: CLIConfig = {};
        fieldFor('groupSingleLineMessages').apply(cfg, false);
        expect(cfg.groupSingleLineMessages).toBe(false);
    });

    describe('serve.serverName', () => {
        it('sets serverName', () => {
            const cfg: CLIConfig = {};
            fieldFor('serve.serverName').apply(cfg, 'prod-server');
            expect(cfg.serve?.serverName).toBe('prod-server');
        });
        it('deletes serverName when null', () => {
            const cfg: CLIConfig = { serve: { serverName: 'old' } };
            fieldFor('serve.serverName').apply(cfg, null);
            expect(cfg.serve?.serverName).toBeUndefined();
        });
        it('deletes serverName when empty string', () => {
            const cfg: CLIConfig = { serve: { serverName: 'old' } };
            fieldFor('serve.serverName').apply(cfg, '');
            expect(cfg.serve?.serverName).toBeUndefined();
        });
    });

    describe('chat.followUpSuggestions.enabled', () => {
        it('initializes nested path and sets value', () => {
            const cfg: CLIConfig = {};
            fieldFor('chat.followUpSuggestions.enabled').apply(cfg, false);
            expect(cfg.chat?.followUpSuggestions?.enabled).toBe(false);
        });
        it('updates existing nested value', () => {
            const cfg: CLIConfig = { chat: { followUpSuggestions: { enabled: true } } };
            fieldFor('chat.followUpSuggestions.enabled').apply(cfg, false);
            expect(cfg.chat?.followUpSuggestions?.enabled).toBe(false);
        });
    });

    describe('chat.followUpSuggestions.count', () => {
        it('sets count, initializing nested path', () => {
            const cfg: CLIConfig = {};
            fieldFor('chat.followUpSuggestions.count').apply(cfg, 4);
            expect(cfg.chat?.followUpSuggestions?.count).toBe(4);
        });
    });

    describe('chat.askUser.enabled', () => {
        it('sets value, initializing nested path', () => {
            const cfg: CLIConfig = {};
            fieldFor('chat.askUser.enabled').apply(cfg, true);
            expect(cfg.chat?.askUser?.enabled).toBe(true);
        });
    });

    // Feature flag nested fields
    const nestedBoolFields: Array<[string, (cfg: CLIConfig) => boolean | undefined]> = [
        ['terminal.enabled', (c) => c.terminal?.enabled],
        ['notes.enabled', (c) => c.notes?.enabled],
        ['myWork.enabled', (c) => c.myWork?.enabled],
        ['myLife.enabled', (c) => c.myLife?.enabled],
        ['scratchpad.enabled', (c) => c.scratchpad?.enabled],
        ['workflows.enabled', (c) => c.workflows?.enabled],
        ['pullRequests.enabled', (c) => c.pullRequests?.enabled],
        ['pullRequests.autoClassifyTeam', (c) => c.pullRequests?.autoClassifyTeam],
        ['servers.enabled', (c) => c.servers?.enabled],
        ['ralph.enabled', (c) => c.ralph?.enabled],
        ['forEach.enabled', (c) => c.forEach?.enabled],
        ['vimNavigation.enabled', (c) => c.vimNavigation?.enabled],
        ['loops.enabled', (c) => c.loops?.enabled],
        ['dreams.enabled', (c) => c.dreams?.enabled],
        ['excalidraw.enabled', (c) => c.excalidraw?.enabled],
        ['mcpOauth.enabled', (c) => c.mcpOauth?.enabled],
        ['features.gitCrossCloneCherryPick', (c) => c.features?.gitCrossCloneCherryPick],
        ['features.sessionContextAttachments', (c) => c.features?.sessionContextAttachments],
        ['features.ralphMultiAgentGrill', (c) => c.features?.ralphMultiAgentGrill],
        ['features.commitChatLens', (c) => c.features?.commitChatLens],
        ['workItems.hierarchy.enabled', (c) => c.workItems?.hierarchy?.enabled],
        ['workItems.sync.enabled', (c) => c.workItems?.sync?.enabled],
        ['workItems.aiAuthoring.enabled', (c) => c.workItems?.aiAuthoring?.enabled],
        ['workItems.workflow.enabled', (c) => c.workItems?.workflow?.enabled],
        ['effortLevels.enabled', (c) => c.effortLevels?.enabled],
    ];

    for (const [key, getter] of nestedBoolFields) {
        describe(key, () => {
            it('sets true, initializing namespace', () => {
                const cfg: CLIConfig = {};
                fieldFor(key).apply(cfg, true);
                expect(getter(cfg)).toBe(true);
            });
            it('sets false, initializing namespace', () => {
                const cfg: CLIConfig = {};
                fieldFor(key).apply(cfg, false);
                expect(getter(cfg)).toBe(false);
            });
        });
    }

    describe('scratchpad.layout', () => {
        it('sets layout', () => {
            const cfg: CLIConfig = {};
            fieldFor('scratchpad.layout').apply(cfg, 'vertical');
            expect(cfg.scratchpad?.layout).toBe('vertical');
        });
    });

    describe('dreams.idleCheckIntervalMs', () => {
        it('sets the interval, initializing the dreams namespace', () => {
            const cfg: CLIConfig = {};
            fieldFor('dreams.idleCheckIntervalMs').apply(cfg, 600_000);
            expect(cfg.dreams?.idleCheckIntervalMs).toBe(600_000);
        });
    });

    describe('features.commitChatLensDormantMode', () => {
        it('applies ghost to config', () => {
            const cfg: CLIConfig = {};
            fieldFor('features.commitChatLensDormantMode').apply(cfg, 'ghost');
            expect(cfg.features?.commitChatLensDormantMode).toBe('ghost');
        });
        it('applies pill to config', () => {
            const cfg: CLIConfig = {};
            fieldFor('features.commitChatLensDormantMode').apply(cfg, 'pill');
            expect(cfg.features?.commitChatLensDormantMode).toBe('pill');
        });
    });

    describe('defaultProvider', () => {
        it('sets copilot', () => {
            const cfg: CLIConfig = {};
            fieldFor('defaultProvider').apply(cfg, 'copilot');
            expect(cfg.defaultProvider).toBe('copilot');
        });
        it('sets codex', () => {
            const cfg: CLIConfig = {};
            fieldFor('defaultProvider').apply(cfg, 'codex');
            expect(cfg.defaultProvider).toBe('codex');
        });
    });

    describe('agentProviderRouting.auto', () => {
        it('sets auto routing config', () => {
            const cfg: CLIConfig = {};
            fieldFor('agentProviderRouting.auto').apply(cfg, {
                rules: [{ provider: 'claude', enabled: true, minimumRemainingPercent: 33 }],
                fallbackProvider: 'copilot',
            });
            expect(cfg.agentProviderRouting?.auto?.rules?.[0].provider).toBe('claude');
            expect(cfg.agentProviderRouting?.auto?.fallbackProvider).toBe('copilot');
        });
    });

});

// ── runtime classification ────────────────────────────────────────────────────

describe('runtime classification', () => {
    it('marks terminal.enabled as restartRequired', () => {
        expect(fieldFor('terminal.enabled').runtime).toBe('restartRequired');
    });

    it('marks loops.enabled as restartRequired', () => {
        expect(fieldFor('loops.enabled').runtime).toBe('restartRequired');
    });

    it('marks mcpOauth.enabled as restartRequired', () => {
        expect(fieldFor('mcpOauth.enabled').runtime).toBe('restartRequired');
    });

    it('marks codex.enabled as live', () => {
        expect(fieldFor('codex.enabled').runtime).toBe('live');
    });

    it('marks defaultProvider as restartRequired', () => {
        expect(fieldFor('defaultProvider').runtime).toBe('restartRequired');
    });

    it('marks agentProviderRouting.auto as restartRequired', () => {
        expect(fieldFor('agentProviderRouting.auto').runtime).toBe('restartRequired');
    });

    it('marks features.autoAgentProviderRouting as restartRequired', () => {
        expect(fieldFor('features.autoAgentProviderRouting').runtime).toBe('restartRequired');
    });

    const liveFeatures = [
        'notes.enabled', 'myWork.enabled', 'myLife.enabled',
        'scratchpad.enabled', 'workflows.enabled', 'pullRequests.enabled', 'pullRequests.autoClassifyTeam',
        'servers.enabled', 'ralph.enabled', 'forEach.enabled', 'vimNavigation.enabled', 'dreams.enabled',
        'excalidraw.enabled', 'features.focusedDiff',
        'features.gitCrossCloneCherryPick',
        'features.sessionContextAttachments',
        'features.ralphMultiAgentGrill',
        'features.commitChatLens',
        'features.commitChatLensDormantMode',
        'workItems.hierarchy.enabled', 'workItems.sync.enabled', 'workItems.aiAuthoring.enabled',
    ];

    for (const key of liveFeatures) {
        it(`marks ${key} as live`, () => {
            expect(fieldFor(key).runtime).toBe('live');
        });
    }
});

// ── getAdminFieldMetadata() ───────────────────────────────────────────────────

describe('getAdminFieldMetadata()', () => {
    it('returns metadata for every registered field', () => {
        const meta = getAdminFieldMetadata();
        for (const field of ADMIN_CONFIG_FIELDS) {
            expect(meta[field.key]).toEqual({ runtime: field.runtime });
        }
    });

    it('includes restartRequired for terminal.enabled', () => {
        const meta = getAdminFieldMetadata();
        expect(meta['terminal.enabled'].runtime).toBe('restartRequired');
    });

    it('includes restartRequired for mcpOauth.enabled', () => {
        const meta = getAdminFieldMetadata();
        expect(meta['mcpOauth.enabled'].runtime).toBe('restartRequired');
    });
});
