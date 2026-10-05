import { describe, expect, it } from 'vitest';
import {
    MESSAGING_COMMAND_SPECS, MESSAGING_HELP_TEXT, MESSAGING_MODE_SPECS, formatMessagingHelp, isMessagingControlCommand, parseMessagingCommand,
    type MessagingCommand,
} from '../../src';

const cases: Array<[string, MessagingCommand]> = [
    ['list repos', { type: 'list-repos', args: '' }],
    ['/list repos', { type: 'list-repos', args: '' }],
    ['/LIST Repo', { type: 'list-repos', args: '' }],
    ['list agents', { type: 'list-repos', args: '' }],
    ['/List Agent', { type: 'list-repos', args: '' }],
    ['select repo 2', { type: 'select-repo', args: '2' }],
    ['/Select Repos My Repo', { type: 'select-repo', args: 'My Repo' }],
    ['list topics', { type: 'list-topics', args: '', verbose: false }],
    ['/list chat topic', { type: 'list-topics', args: '', verbose: false }],
    ['list remotes', { type: 'list-remotes', args: '' }],
    ['/LIST Remote', { type: 'list-remotes', args: '' }],
    ['list topics 1.2', { type: 'list-topics', args: '1.2', verbose: false }],
    ['/List Topics 10.3', { type: 'list-topics', args: '10.3', verbose: false }],
    ['list topics shortcuts@devbox', { type: 'list-topics', args: 'shortcuts@devbox', verbose: false }],
    ['/list chat topics Shortcuts@DevBox', { type: 'list-topics', args: 'Shortcuts@DevBox', verbose: false }],
    ['list topics -v', { type: 'list-topics', args: '', verbose: true }],
    ['/List Chat Topics  -V', { type: 'list-topics', args: '', verbose: true }],
    ['list topics 1.2 -v', { type: 'list-topics', args: '1.2', verbose: true }],
    ['list topics shortcuts@devbox -v', { type: 'list-topics', args: 'shortcuts@devbox', verbose: true }],
    ['create topic', { type: 'create-topic', args: '' }],
    ['/CREATE chat topic', { type: 'create-topic', args: '' }],
    ['select topic 1', { type: 'select-topic', args: '1' }],
    ['/select chat topic abc-123', { type: 'select-topic', args: 'abc-123' }],
    ['help', { type: 'help', args: '' }],
    ['/HELP', { type: 'help', args: '' }],
    ['quota', { type: 'quota', args: '' }],
    ['/Quota', { type: 'quota', args: '' }],
    ['compact', { type: 'compact', args: '' }],
    ['/compact', { type: 'compact', args: '' }],
    ['/CoMpAcT', { type: 'compact', args: '' }],
    ['Compact focus on the WhatsApp relay work', { type: 'compact', args: 'focus on the WhatsApp relay work' }],
    ['/compact  keep the plan\nand open TODOs ', { type: 'compact', args: 'keep the plan\nand open TODOs' }],
    ['compacting is slow', { type: 'chat', args: 'compacting is slow' }],
    ['  /list repos  ', { type: 'list-repos', args: '' }],
    ['/autopilot fix the build', { type: 'chat', args: 'fix the build', mode: 'autopilot' }],
    ['/AUTOPILOT [abc] go', { type: 'chat-explicit', chatId: 'abc', args: 'go', mode: 'autopilot' }],
    ['/ask what changed?', { type: 'chat', args: 'what changed?', mode: 'ask' }],
    ['/ASK [abc] look only', { type: 'chat-explicit', chatId: 'abc', args: 'look only', mode: 'ask' }],
    ['ask me anything', { type: 'chat', args: 'ask me anything' }],
    ['[abc-123] Hello world', { type: 'chat-explicit', chatId: 'abc-123', args: 'Hello world' }],
    ['[abc]\nmulti\nline', { type: 'chat-explicit', chatId: 'abc', args: 'multi\nline' }],
    ['Hello, how are you?', { type: 'chat', args: 'Hello, how are you?' }],
    ['List the files in src', { type: 'chat', args: 'List the files in src' }],
    ['Create a function that adds', { type: 'chat', args: 'Create a function that adds' }],
    ['help me debug this', { type: 'chat', args: 'help me debug this' }],
    ['autopilot mode is broken', { type: 'chat', args: 'autopilot mode is broken' }],
    ['/select repo', { type: 'invalid', args: '/select repo' }],
    ['select repo', { type: 'invalid', args: 'select repo' }],
    ['list topics please', { type: 'invalid', args: 'list topics please' }],
    ['list topics 1.', { type: 'invalid', args: 'list topics 1.' }],
    ['list topics a@b c', { type: 'invalid', args: 'list topics a@b c' }],
    ['list topics -x', { type: 'invalid', args: 'list topics -x' }],
    ['list topics -v 1.2', { type: 'invalid', args: 'list topics -v 1.2' }],
    ['list topics -v -v', { type: 'invalid', args: 'list topics -v -v' }],
    ['/list topics -verbose', { type: 'invalid', args: '/list topics -verbose' }],
    ['list remotes now', { type: 'invalid', args: 'list remotes now' }],
    ['/select remote 1', { type: 'invalid', args: '/select remote 1' }],
    ['/list nonsense', { type: 'invalid', args: '/list nonsense' }],
    ['/unknown', { type: 'invalid', args: '/unknown' }],
    ['/Unknown thing', { type: 'invalid', args: '/Unknown thing' }],
    ['/autopilot', { type: 'chat', args: '', mode: 'autopilot' }],
    ['/autopilot   ', { type: 'chat', args: '', mode: 'autopilot' }],
    ['/ask', { type: 'chat', args: '', mode: 'ask' }],
    ['/asking for help', { type: 'invalid', args: '/asking for help' }],
    ['/help me', { type: 'invalid', args: '/help me' }],
];

describe('parseMessagingCommand', () => {
    it.each(cases)('parses %j', (input, expected) => {
        expect(parseMessagingCommand(input)).toEqual(expected);
    });

    it.each(['ask', 'autopilot', 'ralph', 'sentinel'] as const)('parses the %s prefix without changing its body', mode => {
        expect(parseMessagingCommand(` /${mode.toUpperCase()}  first line\nsecond line `)).toEqual({
            type: 'chat', args: 'first line\nsecond line', mode,
        });
        expect(parseMessagingCommand(`/${mode} [job-in-another-repo] continue`)).toEqual({
            type: 'chat-explicit', chatId: 'job-in-another-repo', args: 'continue', mode,
        });
        expect(parseMessagingCommand(`${mode} is mentioned in ordinary text`)).toEqual({
            type: 'chat', args: `${mode} is mentioned in ordinary text`, mode: undefined,
        });
        expect(parseMessagingCommand(`/${mode}Extra body`)).toEqual({
            type: 'invalid', args: `/${mode}Extra body`,
        });
        // An empty body is a chat with no message, so routers can ask for one.
        expect(parseMessagingCommand(`/${mode}  `)).toEqual({ type: 'chat', args: '', mode });
        expect(MESSAGING_HELP_TEXT).toContain(`/${mode} <message>`);
    });

    it('leaves plain chat mode undefined so follow-ups keep the chat mode', () => {
        expect(parseMessagingCommand('keep going')).toHaveProperty('mode', undefined);
        expect(parseMessagingCommand('[abc] keep going')).toHaveProperty('mode', undefined);
    });

    it('classifies control commands', () => {
        expect(isMessagingControlCommand(parseMessagingCommand('quota'))).toBe(true);
        expect(isMessagingControlCommand(parseMessagingCommand('select topic 1'))).toBe(true);
        expect(isMessagingControlCommand(parseMessagingCommand('/compact'))).toBe(true);
        expect(isMessagingControlCommand(parseMessagingCommand('/nope'))).toBe(false);
        expect(isMessagingControlCommand(parseMessagingCommand('hi'))).toBe(false);
        expect(isMessagingControlCommand(parseMessagingCommand('[id] hi'))).toBe(false);
    });

    it('documents every command and mode from the parser specs', () => {
        for (const spec of MESSAGING_COMMAND_SPECS) {
            expect(MESSAGING_HELP_TEXT).toContain(`${spec.usage}\n${spec.summary}`);
            const sample = spec.usage.replace(/\[[^\]]+\]/g, '').replace(/<[^>]+>/g, 'x');
            expect(parseMessagingCommand(sample).type).toBe(spec.type);
            if (spec.example) {
                expect(MESSAGING_HELP_TEXT).toContain(`Example: ${spec.example}`);
                expect(parseMessagingCommand(spec.example).type).toBe(spec.type);
            }
        }
        for (const spec of MESSAGING_MODE_SPECS) {
            expect(MESSAGING_HELP_TEXT).toContain(`/${spec.mode} <message> — ${spec.summary}`);
        }
        expect(parseMessagingCommand('/ask [chatid] What changed?')).toEqual({
            type: 'chat-explicit', chatId: 'chatid', args: 'What changed?', mode: 'ask',
        });
    });

    it('keeps plain help grouped, compact and free of tables or formatting markers', () => {
        expect(MESSAGING_HELP_TEXT).toBe(formatMessagingHelp());
        for (const group of ['Repos', 'Topics', 'Tools', 'Chat', 'Modes (/ required)']) {
            expect(MESSAGING_HELP_TEXT).toContain(`\n\n${group}\n`);
        }
        expect(MESSAGING_HELP_TEXT.length).toBeLessThan(3000);
        expect(MESSAGING_HELP_TEXT).not.toMatch(/[`*]|<br>|\| *---/);
        expect(MESSAGING_HELP_TEXT).toContain('n.m or repo@server (read-only)');
        expect(MESSAGING_HELP_TEXT).toContain('replied-to chat, else selected topic');
        expect(MESSAGING_HELP_TEXT).toContain('current mode');
        expect(MESSAGING_HELP_TEXT).toContain('Unknown /commands');
    });
});
