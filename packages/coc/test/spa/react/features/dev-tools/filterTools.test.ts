/**
 * Dev Tools filter matching — pure logic, no rendering.
 */
import { describe, expect, it } from 'vitest';
import { filterTools, toolMatchesQuery } from '../../../../../src/server/spa/client/react/features/dev-tools/logic/filterTools';

const tools = [
    { id: 'calculator', name: 'Programmer calculator', description: 'C-style integer expressions', keywords: ['hex', 'binary'] },
    { id: 'encoders', name: 'Encoders / decoders', description: 'Base64, URL, HTML entities', keywords: ['b64', 'base64', 'url'] },
    { id: 'timestamp', name: 'Timestamp converter', description: 'Epoch to ISO 8601', keywords: ['time', 'epoch'] },
];

describe('toolMatchesQuery', () => {
    it('matches everything for an empty or whitespace query', () => {
        expect(toolMatchesQuery(tools[0], '')).toBe(true);
        expect(toolMatchesQuery(tools[0], '   ')).toBe(true);
    });

    it('matches on name, case-insensitively', () => {
        expect(toolMatchesQuery(tools[0], 'PROGRAMMER')).toBe(true);
    });

    it('matches on description', () => {
        expect(toolMatchesQuery(tools[2], 'iso 8601')).toBe(true);
    });

    it('matches on a keyword alias the name does not contain', () => {
        expect(toolMatchesQuery(tools[1], 'b64')).toBe(true);
    });

    it('does not match unrelated text', () => {
        expect(toolMatchesQuery(tools[0], 'jwt')).toBe(false);
    });
});

describe('filterTools', () => {
    it('returns every tool for an empty query', () => {
        expect(filterTools(tools, '').map(t => t.id)).toEqual(['calculator', 'encoders', 'timestamp']);
    });

    it('narrows to the matching tools', () => {
        expect(filterTools(tools, 'base64').map(t => t.id)).toEqual(['encoders']);
    });

    it('can match more than one tool', () => {
        expect(filterTools(tools, 'time').map(t => t.id)).toEqual(['timestamp']);
    });

    it('returns nothing when nothing matches', () => {
        expect(filterTools(tools, 'zzz')).toEqual([]);
    });
});
