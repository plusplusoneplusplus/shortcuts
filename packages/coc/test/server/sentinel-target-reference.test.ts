import { describe, expect, it } from 'vitest';
import { parseTargetHref, targetHref, targetPlainText, targetQuery, targetSpans, targetToken, withSentinelTargetContext, type SentinelTarget } from '../../src/server/shared/sentinel-target-reference';

const repo: SentinelTarget = { kind: 'workspace', serverIdentity: 'durable/server', workspaceId: 'ws exact' };
describe('Sentinel target serialization and parsing', () => {
    it.each<SentinelTarget>([repo, { kind: 'server', serverIdentity: 'machine' }, { kind: 'group', serverIdentity: 'remote', groupId: 'group-a' }])('round trips exact durable identity: $kind', target => {
        expect(parseTargetHref(targetHref(target))).toEqual(target);
        expect(targetSpans(targetToken(target, '#Owner / shortcuts'))[0].target).toEqual(target);
    });
    it('keeps duplicate names distinct and multiple inline references ordered', () => {
        const other: SentinelTarget = { ...repo, serverIdentity: 'other' };
        const text = `Compare ${targetToken(repo, '#Local / shortcuts')} and ${targetToken(other, '#ubuntu-arm / shortcuts')}`;
        expect(targetSpans(text).map(s => s.target)).toEqual([repo, other]);
        expect(targetPlainText(text)).toBe('Compare #Local / shortcuts and #ubuntu-arm / shortcuts');
        expect(withSentinelTargetContext(text)).toContain(JSON.stringify([repo, other]));
        expect(withSentinelTargetContext(text)).toContain('References grant no permission');
    });
    it('never infers workspace identity from a server reference', () => {
        const expanded = withSentinelTargetContext(targetToken({ kind: 'server', serverIdentity: 'host' }, '#host'));
        expect(expanded).toContain('[{"kind":"server","serverIdentity":"host"}]');
        expect(expanded).toContain('A server reference selects no workspace');
    });
    it.each(['#abc', 'Compare #short', '(#short', 'look\n#short', '#ubuntu-arm/short'])('recognizes word boundaries: %s', text => {
        expect(targetQuery(text, text.length)).toMatchObject({ query: text.slice(text.lastIndexOf('#') + 1) });
    });
    it.each(['\\#short', 'abc#short', 'https://host/#short', 'https://host:#short', '[link](#short', '# heading #short', '## #short', '`#short', '``code #short', '```ts\n#short', '~~~\n#short', 'hello `#short`'])('excludes literal Markdown and URL fragments: %s', text => {
        expect(targetQuery(text, text.length)).toBeNull();
    });
    it('resumes after closing fences, inline code, and escaped backslashes', () => {
        for (const prefix of ['```\n#code\n```\n', '~~~\n#code\n~~~\n', '`inline` ', '\\\\ ']) {
            const text = prefix + '#short';
            expect(targetQuery(text, text.length)?.query).toBe('short');
        }
    });
    it('does not parse references in excluded regions or leave targets after edits/removal', () => {
        const token = targetToken(repo, '#Local / shortcuts');
        expect(targetSpans('`' + token + '`')).toEqual([]);
        expect(targetSpans('```\n' + token + '\n```')).toEqual([]);
        expect(targetSpans(token.replace('v1/', 'v2/'))).toEqual([]);
        expect(targetSpans(targetPlainText(token))).toEqual([]);
        expect(withSentinelTargetContext('Normal typing')).toBe('Normal typing');
    });
    it.each(['#sentinel-targets/v1/server/a/ws', '#sentinel-targets/v1/workspace/a', '#sentinel-targets/v1/group/a/%00', '#sentinel-targets/v1/server/%ZZ', '#sentinel-targets/v1/alias/local/id'])('rejects invalid identity links: %s', link => {
        expect(parseTargetHref(link)).toBeNull();
    });
});
