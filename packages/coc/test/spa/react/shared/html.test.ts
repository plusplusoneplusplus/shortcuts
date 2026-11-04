import { describe, expect, it } from 'vitest';
import { escapeHtmlAttribute, escapeHtmlText } from '../../../../src/server/spa/client/shared/html';
import { escapeHtml } from '../../../../src/server/spa/client/react/utils/format';
import { escapeHtml as encodeHtml } from '../../../../src/server/spa/client/react/features/dev-tools/logic/encoders';
import { renderAskUserMarkdown } from '../../../../src/server/spa/client/react/features/chat/AskUserMarkdown';

describe('HTML escaping contexts', () => {
    it.each([
        ['', '', '', ''],
        ['plain 日本語 🎨', 'plain 日本語 🎨', 'plain 日本語 🎨', 'plain 日本語 🎨'],
        [
            `<a title="'">&amp;</a>`,
            `&lt;a title="'"&gt;&amp;amp;&lt;/a&gt;`,
            `&lt;a title=&quot;'&quot;&gt;&amp;amp;&lt;/a&gt;`,
            '&lt;a title=&quot;&#39;&quot;&gt;&amp;amp;&lt;/a&gt;',
        ],
    ])('preserves the distinct quote policies for %j', (input, text, doubleQuoted, bothQuoted) => {
        expect(escapeHtmlText(input)).toBe(text);
        expect(escapeHtml(input)).toBe(doubleQuoted);
        expect(escapeHtmlAttribute(input)).toBe(bothQuoted);
        expect(encodeHtml(input)).toEqual({ ok: true, value: bothQuoted });
    });

    it('keeps canonical nullish handling', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('escapes raw Ask User HTML as text without encoding its quote delimiters', () => {
        const html = renderAskUserMarkdown(`<span title="'">unsafe</span>`);
        expect(html).toContain(`&lt;span title="'"&gt;unsafe&lt;/span&gt;`);
        expect(html).not.toContain('<span');
    });
});
