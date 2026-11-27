import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../../../src/server/spa/client/react/features/notes/editor/RichEditorCore.tsx'), 'utf8');

describe('Notes editor stylesheet order', () => {
    it('loads shared editor CSS before CoC overrides', () => {
        const shared = source.indexOf("import '@plusplusoneplusplus/tiptap-react/styles.css';");
        const host = source.indexOf("import './noteEditor.css';");
        expect(shared).toBeGreaterThanOrEqual(0);
        expect(host).toBeGreaterThan(shared);
    });
});
