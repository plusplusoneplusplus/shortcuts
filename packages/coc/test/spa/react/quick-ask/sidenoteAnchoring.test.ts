import { afterEach, describe, expect, it } from 'vitest';
import {
    anchorToTextAnchor,
    collectTextNodes,
    offsetsToRange,
    pointAtOffset,
    resolveSidenoteAnchor,
} from '../../../../src/server/spa/client/react/features/chat/quick-ask/sidenoteAnchoring';
import type { QuickAskAnchor } from '../../../../src/server/spa/client/react/features/chat/quick-ask/types';

/** Build a detached container from an HTML string (rendered-turn stand-in). */
function makeContainer(html: string): HTMLElement {
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

function anchor(partial: Partial<QuickAskAnchor>): QuickAskAnchor {
    return {
        selectedText: '',
        contextBefore: '',
        contextAfter: '',
        fingerprint: '',
        ...partial,
    };
}

afterEach(() => {
    document.body.innerHTML = '';
});

describe('anchorToTextAnchor', () => {
    it('maps side-note anchor fields onto the shared TextAnchor shape', () => {
        const ta = anchorToTextAnchor(
            anchor({ selectedText: 'GroupedGEMM', contextBefore: 'Megatron ', contextAfter: ' kernel' }),
        );
        expect(ta).toEqual({ quotedText: 'GroupedGEMM', prefix: 'Megatron ', suffix: ' kernel' });
    });

    it('coerces missing fields to empty strings', () => {
        const ta = anchorToTextAnchor({ selectedText: 'x' } as QuickAskAnchor);
        expect(ta).toEqual({ quotedText: 'x', prefix: '', suffix: '' });
    });
});

describe('collectTextNodes / pointAtOffset / offsetsToRange', () => {
    it('walks text nodes across nested elements in document order', () => {
        const el = makeContainer('<span>ab</span><b>cd</b>ef');
        const nodes = collectTextNodes(el);
        expect(nodes.map(n => n.data)).toEqual(['ab', 'cd', 'ef']);
        expect(el.textContent).toBe('abcdef');
    });

    it('maps a plain-text offset onto the correct node and local offset', () => {
        const el = makeContainer('<span>ab</span><b>cd</b>ef');
        const nodes = collectTextNodes(el);
        expect(pointAtOffset(nodes, 0)).toMatchObject({ offset: 0 });
        expect(pointAtOffset(nodes, 3)?.node.data).toBe('cd');
        expect(pointAtOffset(nodes, 3)?.offset).toBe(1);
        // Boundary: offset at the seam prefers the earlier node's end.
        expect(pointAtOffset(nodes, 2)?.node.data).toBe('ab');
        expect(pointAtOffset(nodes, 2)?.offset).toBe(2);
    });

    it('builds a range whose text equals the requested interval across nodes', () => {
        const el = makeContainer('<span>ab</span><b>cd</b>ef');
        const range = offsetsToRange(el, 1, 5); // "bcde"
        expect(range).not.toBeNull();
        expect(range!.toString()).toBe('bcde');
    });

    it('returns null when there are no text nodes', () => {
        const el = makeContainer('');
        expect(offsetsToRange(el, 0, 1)).toBeNull();
    });
});

describe('resolveSidenoteAnchor — exact single match', () => {
    it('locates a unique phrase and returns an exact range', () => {
        const el = makeContainer('<p>The Megatron GroupedGEMM kernel is fast.</p>');
        const res = resolveSidenoteAnchor(
            el,
            anchor({
                selectedText: 'GroupedGEMM',
                contextBefore: 'The Megatron ',
                contextAfter: ' kernel is fast.',
            }),
        );
        expect(res.located).toBe(true);
        if (!res.located) {return;}
        expect(res.confidence).toBe('exact');
        expect(res.range.toString()).toBe('GroupedGEMM');
    });

    it('locates a phrase that spans inline markup boundaries', () => {
        // "brown fox" straddles a <strong> boundary in the rendered DOM.
        const el = makeContainer('<p>The quick <strong>brown</strong> fox jumps.</p>');
        const res = resolveSidenoteAnchor(
            el,
            anchor({ selectedText: 'brown fox', contextBefore: 'The quick ', contextAfter: ' jumps.' }),
        );
        expect(res.located).toBe(true);
        if (!res.located) {return;}
        expect(res.range.toString()).toBe('brown fox');
    });
});

describe('resolveSidenoteAnchor — exact but ambiguous, resolved by context', () => {
    it('picks the occurrence whose surrounding context matches', () => {
        const el = makeContainer(
            '<p>the model uses attention here and attention there in the stack</p>',
        );
        const res = resolveSidenoteAnchor(
            el,
            anchor({
                selectedText: 'attention',
                contextBefore: 'here and ',
                contextAfter: ' there in',
            }),
        );
        expect(res.located).toBe(true);
        if (!res.located) {return;}
        expect(res.range.toString()).toBe('attention');
        // Second occurrence starts at index 33; the first is at index 15.
        expect(res.from).toBe(el.textContent!.indexOf('attention', 20));
    });
});

describe('resolveSidenoteAnchor — fuzzy fallback', () => {
    it('locates the source after a minor whitespace/markup difference', () => {
        // Anchor was captured as "GroupedGEMM kernels" but the rendered turn
        // now reads "Grouped GEMM kernels" (a space was introduced on re-render).
        const el = makeContainer('<p>Megatron Grouped GEMM kernels are used for MoE.</p>');
        const res = resolveSidenoteAnchor(
            el,
            anchor({
                selectedText: 'GroupedGEMM kernels',
                contextBefore: 'Megatron ',
                contextAfter: ' are used',
            }),
        );
        expect(res.located).toBe(true);
        if (!res.located) {return;}
        expect(res.confidence).toBe('fuzzy');
        expect(res.range.toString().toLowerCase()).toContain('gemm kernels');
    });
});

describe('resolveSidenoteAnchor — not located', () => {
    it('returns not-located when the text is absent', () => {
        const el = makeContainer('<p>A completely unrelated paragraph of prose.</p>');
        const res = resolveSidenoteAnchor(
            el,
            anchor({ selectedText: 'GroupedGEMM', contextBefore: 'Megatron ', contextAfter: ' kernel' }),
        );
        expect(res.located).toBe(false);
    });

    it('returns not-located for empty/absent inputs', () => {
        const el = makeContainer('<p>anything</p>');
        expect(resolveSidenoteAnchor(null, anchor({ selectedText: 'x' })).located).toBe(false);
        expect(resolveSidenoteAnchor(el, null).located).toBe(false);
        expect(resolveSidenoteAnchor(el, anchor({ selectedText: '' })).located).toBe(false);
        expect(resolveSidenoteAnchor(makeContainer(''), anchor({ selectedText: 'x' })).located).toBe(false);
    });
});
