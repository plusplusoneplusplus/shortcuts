/**
 * Verifies that every module under shared/ is re-exported from the barrel
 * (shared/index.ts). This test will catch regressions where new files are
 * added to shared/ but forgotten in the barrel — ensuring Phase 2+ moves
 * stay safe.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';

const SHARED_DIR = join(process.cwd(), 'src/server/spa/client/react/shared');

describe('shared/ barrel completeness', () => {
    it('index.ts re-exports every module in shared/', () => {
        const allFiles = readdirSync(SHARED_DIR).filter(
            f => (f.endsWith('.ts') || f.endsWith('.tsx')) && f !== 'index.ts',
        );

        const barrelContent = readFileSync(join(SHARED_DIR, 'index.ts'), 'utf-8');

        const missing: string[] = [];
        for (const file of allFiles) {
            const stem = `./${basename(file, file.endsWith('.tsx') ? '.tsx' : '.ts')}`;
            if (!barrelContent.includes(`from '${stem}'`)) {
                missing.push(file);
            }
        }

        expect(missing, `shared/ files not re-exported in index.ts:\n  ${missing.join('\n  ')}`).toEqual([]);
    });
});

describe('features/ namespace', () => {
    it('features/index.ts exists and is a valid module', () => {
        const featuresIndex = join(
            process.cwd(),
            'src/server/spa/client/react/features/index.ts',
        );
        const content = readFileSync(featuresIndex, 'utf-8');
        expect(content).toBeTruthy();
    });
});
