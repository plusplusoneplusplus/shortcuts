/**
 * Verifies barrel completeness for both shared/ and ui/ directories.
 * Catches regressions where new files are added but forgotten in the barrel.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';

const REACT_DIR = join(process.cwd(), 'src/server/spa/client/react');
const SHARED_DIR = join(REACT_DIR, 'shared');
const UI_DIR = join(REACT_DIR, 'ui');

function getModuleFiles(dir: string): string[] {
    return readdirSync(dir).filter(
        f => (f.endsWith('.ts') || f.endsWith('.tsx')) && f !== 'index.ts',
    );
}

function getStem(file: string): string {
    return basename(file, file.endsWith('.tsx') ? '.tsx' : '.ts');
}

describe('shared/ barrel completeness', () => {
    it('index.ts re-exports every module in shared/ (directly or via ../ui/)', () => {
        const allFiles = getModuleFiles(SHARED_DIR);
        const barrelContent = readFileSync(join(SHARED_DIR, 'index.ts'), 'utf-8');

        const missing: string[] = [];
        for (const file of allFiles) {
            const stem = getStem(file);
            const hasLocal = barrelContent.includes(`from './${stem}'`);
            const hasUi = barrelContent.includes(`from '../ui/${stem}'`);
            if (!hasLocal && !hasUi) {
                missing.push(file);
            }
        }

        expect(missing, `shared/ files not re-exported in index.ts:\n  ${missing.join('\n  ')}`).toEqual([]);
    });
});

describe('ui/ barrel completeness', () => {
    it('index.ts re-exports every module in ui/', () => {
        const allFiles = getModuleFiles(UI_DIR);
        const barrelContent = readFileSync(join(UI_DIR, 'index.ts'), 'utf-8');

        const missing: string[] = [];
        for (const file of allFiles) {
            const stem = `./${getStem(file)}`;
            if (!barrelContent.includes(`from '${stem}'`)) {
                missing.push(file);
            }
        }

        expect(missing, `ui/ files not re-exported in ui/index.ts:\n  ${missing.join('\n  ')}`).toEqual([]);
    });
});

describe('features/ namespace', () => {
    it('features/index.ts exists and is a valid module', () => {
        const featuresIndex = join(REACT_DIR, 'features/index.ts');
        const content = readFileSync(featuresIndex, 'utf-8');
        expect(content).toBeTruthy();
    });
});
