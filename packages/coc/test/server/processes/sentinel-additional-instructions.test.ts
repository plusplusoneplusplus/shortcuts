import { describe, it, expect, vi } from 'vitest';
import {
    ADDITIONAL_INSTRUCTIONS_PREAMBLE,
    ADDITIONAL_INSTRUCTIONS_TAG,
    buildAdditionalInstructionsBlock,
    resolveAdditionalInstructionsBlock,
    withAdditionalInstructions,
} from '../../../src/server/processes/sentinel-additional-instructions';

const OPEN = `<${ADDITIONAL_INSTRUCTIONS_TAG}>`;
const CLOSE = `</${ADDITIONAL_INSTRUCTIONS_TAG}>`;

describe('buildAdditionalInstructionsBlock', () => {
    it('wraps saved text with the fixed non-overriding preamble', () => {
        const block = buildAdditionalInstructionsBlock('  Line one\nLine two  ')!;
        expect(block).toBe(`${OPEN}\n${ADDITIONAL_INSTRUCTIONS_PREAMBLE}\n\nLine one\nLine two\n${CLOSE}`);
        expect(ADDITIONAL_INSTRUCTIONS_PREAMBLE).toContain('grant no permissions');
    });

    it('returns undefined for empty or whitespace-only text', () => {
        expect(buildAdditionalInstructionsBlock('')).toBeUndefined();
        expect(buildAdditionalInstructionsBlock(' \n\t')).toBeUndefined();
    });

    it('defuses a literal closing tag so the text cannot end the block', () => {
        const block = buildAdditionalInstructionsBlock(`before ${CLOSE} after`)!;
        expect(block.split(CLOSE)).toHaveLength(2);
        expect(block.endsWith(CLOSE)).toBe(true);
        expect(block).toContain('after');
    });
});

describe('resolveAdditionalInstructionsBlock', () => {
    const store = (metadata: unknown, fail = false) => ({
        getProcess: vi.fn(async () => {
            if (fail) throw new Error('boom');
            return { id: 'p', metadata };
        }),
    }) as any;

    it('reads the latest saved text from the store', async () => {
        const s = store({ type: 'chat', additionalInstructions: { text: 'Be brief.' } });
        expect(await resolveAdditionalInstructionsBlock(s, 'p', true)).toContain('Be brief.');
        expect(s.getProcess).toHaveBeenCalledWith('p');
    });

    it('skips the read entirely when the flag is off', async () => {
        const s = store({ type: 'chat', additionalInstructions: { text: 'Be brief.' } });
        expect(await resolveAdditionalInstructionsBlock(s, 'p', false)).toBeUndefined();
        expect(s.getProcess).not.toHaveBeenCalled();
    });

    it('yields nothing for missing values and never throws on read failures', async () => {
        expect(await resolveAdditionalInstructionsBlock(store({ type: 'chat' }), 'p', true)).toBeUndefined();
        expect(await resolveAdditionalInstructionsBlock(store(undefined, true), 'p', true)).toBeUndefined();
    });
});

describe('withAdditionalInstructions', () => {
    it('appends the block after the directive only when both exist', () => {
        expect(withAdditionalInstructions('D', 'B')).toBe('D\n\nB');
        expect(withAdditionalInstructions('D', undefined)).toBe('D');
        expect(withAdditionalInstructions(undefined, 'B')).toBeUndefined();
    });
});
