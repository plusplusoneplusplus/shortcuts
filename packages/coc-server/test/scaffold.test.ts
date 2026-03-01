import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

const packageRoot = path.resolve(__dirname, '..');

describe('coc-server package scaffold', () => {
    it('should have a valid package.json', () => {
        const pkgPath = path.join(packageRoot, 'package.json');
        expect(fs.existsSync(pkgPath)).toBe(true);

        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        expect(pkg.name).toBe('@plusplusoneplusplus/coc-server');
        expect(pkg.version).toBe('1.0.0');
        expect(pkg.main).toBe('dist/index.js');
        expect(pkg.types).toBe('dist/index.d.ts');
    });

    it('should have correct dependencies', () => {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')
        );
        expect(pkg.dependencies).toHaveProperty('@plusplusoneplusplus/pipeline-core');
        expect(pkg.dependencies).toHaveProperty('ws');
        expect(pkg.dependencies).toHaveProperty('js-yaml');
    });

    it('should have build and test scripts', () => {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')
        );
        expect(pkg.scripts.build).toBe('npm run build:client && tsc');
        expect(pkg.scripts.test).toBe('vitest');
        expect(pkg.scripts['test:run']).toBe('vitest run');
    });

    it('should have a valid tsconfig.json', () => {
        const tsconfigPath = path.join(packageRoot, 'tsconfig.json');
        expect(fs.existsSync(tsconfigPath)).toBe(true);

        const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
        expect(tsconfig.compilerOptions.module).toBe('commonjs');
        expect(tsconfig.compilerOptions.target).toBe('ES2020');
        expect(tsconfig.compilerOptions.outDir).toBe('dist');
        expect(tsconfig.compilerOptions.rootDir).toBe('src');
        expect(tsconfig.compilerOptions.strict).toBe(true);
        expect(tsconfig.compilerOptions.declaration).toBe(true);
    });

    it('should have src directory with index.ts', () => {
        const srcDir = path.join(packageRoot, 'src');
        expect(fs.existsSync(srcDir)).toBe(true);
        expect(fs.statSync(srcDir).isDirectory()).toBe(true);
        expect(fs.existsSync(path.join(srcDir, 'index.ts'))).toBe(true);
    });

    it('should produce build output in dist/', () => {
        const distDir = path.join(packageRoot, 'dist');
        expect(fs.existsSync(distDir)).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'index.js'))).toBe(true);
        expect(fs.existsSync(path.join(distDir, 'index.d.ts'))).toBe(true);
    });

    it('should be listed in root workspaces', () => {
        const rootPkgPath = path.resolve(packageRoot, '..', '..', 'package.json');
        const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
        expect(rootPkg.workspaces).toContain('packages/coc-server');
    });
});
