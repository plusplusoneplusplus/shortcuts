import { describe, expect, it } from 'vitest';
import type { TeamsIc3Message } from '@plusplusoneplusplus/coc-native';
import {
    admitTeamsIc3OwnCommand, type TeamsIc3OwnCommandContext,
} from '../../../src/server/messaging/teams-ic3-own-command-admission';

const account = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};
function context(kind = 'oneOnOne', chatId = '19:fixture@thread.v2'): TeamsIc3OwnCommandContext {
    return { account, chat: { chatId, kind } };
}
function message(patch: Partial<TeamsIc3Message> = {}): TeamsIc3Message {
    return {
        chatId: '19:fixture@thread.v2', messageId: 'command-1',
        createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z',
        deleted: false, authorKind: 'user', authorId: account.userId,
        text: '@coc explain this', textTruncated: false, htmlTruncated: false, ...patch,
    };
}
function parse(text: string, html = false) {
    return admitTeamsIc3OwnCommand(context(), message(html ? { untrustedHtml: text } : { text }));
}

describe('IC3 own-human command classification', () => {
    it.each([
        ['oneOnOne', '19:fixture@thread.v2'],
        ['group', '19:fixture-group@thread.v2'],
        ['self', '48:notes'],
    ])('accepts an own literal command in %s', (kind, chatId) => {
        expect(admitTeamsIc3OwnCommand(context(kind, chatId), message({ chatId })))
            .toEqual({ kind: 'command', prompt: 'explain this' });
    });

    it.each([
        ['@CoC explain this', 'explain this'],
        ['@COC\tquestion\nmore', 'question\nmore'],
        ['@coc \n explain this  ', 'explain this'],
        ['@coc /autopilot explain', '/autopilot explain'],
        ['@coc A_b & C < D', 'A_b & C < D'],
    ])('extracts only the prompt from %j without interpreting mode syntax', (text, prompt) => {
        expect(parse(text)).toEqual({ kind: 'command', prompt });
    });

    it.each([
        '@coc', '@coc ', '@coc\n\t', '@cocquestion', '@coc: explain',
        'before @coc explain', ' @coc explain', '> @coc explain',
        '"@coc explain"', '`@coc explain`', '```\n@coc explain\n```',
        'forwarded:\n@coc explain', '@\u200bcoc explain',
    ])('ignores nonliteral or quoted prefix %j', text => {
        expect(parse(text)).toMatchObject({ kind: 'ignored', reason: 'not-command' });
    });

    it.each<Partial<TeamsIc3Message>>([
        { authorId: undefined }, { authorId: 'another-user' }, { authorId: ` ${account.userId}` },
        { authorKind: 'application' }, { authorKind: 'unknown' }, { authorKind: '' },
    ])('rejects absent, foreign and application authorship %j', patch => {
        expect(admitTeamsIc3OwnCommand(context(), message(patch)))
            .toEqual({ kind: 'ignored', reason: 'foreign-sender' });
    });

    it('compares the normalized native object identity case-insensitively', () => {
        expect(admitTeamsIc3OwnCommand(context(), message({ authorId: account.userId.toUpperCase() })))
            .toMatchObject({ kind: 'command' });
    });

    it.each<Partial<TeamsIc3Message>>([
        { chatId: '19:other@thread.v2' }, { messageId: '' }, { messageId: ' ' },
        { createdAt: '' }, { modifiedAt: 'invalid' },
    ])('rejects invalid or cross-chat evidence %j', patch => {
        expect(admitTeamsIc3OwnCommand(context(), message(patch)))
            .toEqual({ kind: 'ignored', reason: 'invalid-evidence' });
    });

    it.each(['channel', 'unknown', 'self'])('excludes ordinary IDs with unsupported kind %s', kind => {
        expect(admitTeamsIc3OwnCommand(context(kind), message()))
            .toEqual({ kind: 'ignored', reason: 'unsupported-chat' });
    });

    it('requires explicit self-stream classification', () => {
        expect(admitTeamsIc3OwnCommand(context('oneOnOne', '48:notes'), message({ chatId: '48:notes' })))
            .toEqual({ kind: 'ignored', reason: 'unsupported-chat' });
    });

    it.each<Partial<TeamsIc3Message>>([
        { deleted: true }, { modifiedAt: '2026-01-01T00:00:01.000Z' },
        { modifiedAt: '2025-12-31T23:59:59.999Z' },
    ])('never accepts edits or tombstones %j', patch => {
        expect(admitTeamsIc3OwnCommand(context(), message(patch)))
            .toEqual({ kind: 'ignored', reason: 'edited-or-deleted' });
    });

    it.each<Partial<TeamsIc3Message>>([
        { textTruncated: true }, { htmlTruncated: true },
        { text: '@coc ' + 'x'.repeat(16384) },
        { untrustedHtml: '<p>@coc ' + 'x'.repeat(16384) + '</p>' },
        { text: '@coc ' + '\u00e9'.repeat(8192) },
    ])('rejects partial or over-budget bodies (case %#)', patch => {
        expect(admitTeamsIc3OwnCommand(context(), message(patch)))
            .toEqual({ kind: 'ignored', reason: 'incomplete-body' });
    });

    it('requires a literal command, not a presentation label or mention metadata', () => {
        expect(parse('@coc CoC generated label')).toMatchObject({ kind: 'command' });
        expect(admitTeamsIc3OwnCommand(context(), message({ mentionedUserIds: ['someone-else'] })))
            .toMatchObject({ kind: 'command' });
        expect(admitTeamsIc3OwnCommand(context(), message({ text: 'hello', mentionedUserIds: ['coc'] })))
            .toMatchObject({ kind: 'ignored' });
    });

    it('treats answer as ordinary prompt text', () => {
        expect(parse('@coc answer this')).toEqual({ kind: 'command', prompt: 'answer this' });
        expect(parse('@coc answers please')).toEqual({ kind: 'command', prompt: 'answers please' });
    });
});

describe('IC3 rich text and quote exclusion', () => {
    it.each([
        ['<p>@coc explain <b>A_b</b> &amp; C</p>', 'explain A_b & C'],
        ['<div>@CoC first<br>second</div>', 'first\nsecond'],
        ['<blockquote>@coc ignored</blockquote><p>@coc new</p>', 'new'],
        ['<p>@coc new</p><blockquote>secret quoted history</blockquote>', 'new'],
        ['<p>@coc new</p><attachment id="file">secret attachment</attachment>', 'new'],
        ['<div itemtype="http://schema.skype.com/Reply"><p>@coc old</p></div><p>@coc new</p>', 'new'],
        ['<div class="forwarded-message">@coc old</div><p>@coc new</p>', 'new'],
        ['<p>@coc new <img alt="secret" src="https://example.invalid/image"></p>', 'new'],
        ['<p>@coc new <a href="https://example.invalid/secret">label</a></p>', 'new label'],
        ['<p>@coc new</p><!-- @coc ignored -->', 'new'],
    ])('uses visible nonquoted text in %j', (html, prompt) => {
        expect(parse(html, true)).toEqual({ kind: 'command', prompt });
    });

    it.each([
        '<blockquote><p>@coc old</p></blockquote>',
        '<div class="quoted">@coc old</div>',
        '<swift>@coc card</swift>', '<attachment>@coc file</attachment>',
        '<p><at>@coc</at> not a literal command</p>',
        '<p>@<blockquote>ignored</blockquote>coc fabricated</p>',
        '<p>@<attachment id="file"></attachment>coc fabricated</p>',
        '<p>@<quote></quote>coc fabricated</p>',
        '<script>@coc script</script>', '<p>@coc&nbsp;</p>',
        '<pre>@coc code example</pre>', '<p><code>@coc code example</code></p>',
    ])('cannot admit excluded regions as commands: %j', html => {
        expect(parse(html, true)).toMatchObject({ kind: 'ignored', reason: 'not-command' });
    });

    it('does not use the flattened native text when authoritative HTML contains only a quote', () => {
        expect(admitTeamsIc3OwnCommand(context(), message({ untrustedHtml: '<blockquote>@coc old</blockquote>' })))
            .toMatchObject({ kind: 'ignored', reason: 'not-command' });
    });

    it('excludes Markdown quotation bodies without passing them to the AI', () => {
        expect(parse('@coc new\n\n> private history\n> @coc old'))
            .toEqual({ kind: 'command', prompt: 'new' });
        expect(parse('@coc new\n\n> private history\n\ncontinue'))
            .toEqual({ kind: 'command', prompt: 'new\n\n\ncontinue' });
        expect(parse('> @coc old\n\n@coc new')).toEqual({ kind: 'command', prompt: 'new' });
    });

    it('preserves code samples within a fresh command without admitting code as the prefix', () => {
        expect(parse('<p>@coc explain <code>A_b</code></p>', true))
            .toEqual({ kind: 'command', prompt: 'explain `A_b`' });
    });

    it('accepts exactly the native body byte limit', () => {
        const text = '@coc ' + 'x'.repeat(16 * 1024 - 5);
        expect(parse(text)).toEqual({ kind: 'command', prompt: text.slice(5) });
    });
});
