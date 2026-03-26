import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const cocRoot = resolve(__dirname, '..');
const repoRoot = resolve(cocRoot, '..', '..');

describe('coc publish configuration', () => {
  const pkg = JSON.parse(readFileSync(resolve(cocRoot, 'package.json'), 'utf-8'));

  it('should declare forge in bundledDependencies', () => {
    expect(pkg.bundledDependencies).toBeDefined();
    expect(pkg.bundledDependencies).toContain('@plusplusoneplusplus/forge');
  });

  it('should have public publishConfig', () => {
    expect(pkg.publishConfig).toBeDefined();
    expect(pkg.publishConfig.access).toBe('public');
  });

  it('should list forge in dependencies', () => {
    expect(pkg.dependencies['@plusplusoneplusplus/forge']).toBeDefined();
  });

  it('should have build-coc-publish.sh script', () => {
    expect(existsSync(resolve(repoRoot, 'scripts', 'build-coc-publish.sh'))).toBe(true);
  });

  it('should have build-coc-publish.ps1 script', () => {
    expect(existsSync(resolve(repoRoot, 'scripts', 'build-coc-publish.ps1'))).toBe(true);
  });
});
