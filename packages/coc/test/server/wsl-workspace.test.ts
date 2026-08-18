import { describe, expect, it } from 'vitest';
import { detectWslWorkspace } from '../../src/server/wsl-workspace';

describe('detectWslWorkspace', () => {
    it('recognizes a backslash `wsl$` UNC root', () => {
        expect(detectWslWorkspace(String.raw`\\wsl$\Ubuntu\home\u\repo`)).toEqual({ distro: 'Ubuntu' });
    });

    it('recognizes a forward-slash `wsl.localhost` root', () => {
        expect(detectWslWorkspace('//wsl.localhost/Ubuntu-24.04/home/u/repo')).toEqual({
            distro: 'Ubuntu-24.04',
        });
    });

    it('recognizes the remaining prefix/separator combinations', () => {
        expect(detectWslWorkspace('//wsl$/Debian/srv')).toEqual({ distro: 'Debian' });
        expect(detectWslWorkspace(String.raw`\\wsl.localhost\Debian\srv`)).toEqual({ distro: 'Debian' });
    });

    it('matches the share prefix case-insensitively', () => {
        expect(detectWslWorkspace(String.raw`\\WSL$\Ubuntu\home`)).toEqual({ distro: 'Ubuntu' });
        expect(detectWslWorkspace('//WSL.LocalHost/Ubuntu/home')).toEqual({ distro: 'Ubuntu' });
    });

    it('returns null for a Windows drive path', () => {
        expect(detectWslWorkspace(String.raw`C:\src\repo`)).toBeNull();
        expect(detectWslWorkspace('C:/src/repo')).toBeNull();
    });

    it('returns null for a Linux path on a non-WSL host', () => {
        expect(detectWslWorkspace('/home/u/repo')).toBeNull();
        expect(detectWslWorkspace('/home/u/repo', { isNativeWsl: false })).toBeNull();
        expect(detectWslWorkspace('/Users/u/repo', { isNativeWsl: false })).toBeNull();
    });

    it('marks a Linux path as WSL when the server itself runs inside WSL', () => {
        expect(detectWslWorkspace('/home/u/repo', { isNativeWsl: true, wslDistro: 'Ubuntu' })).toEqual({
            distro: 'Ubuntu',
        });
    });

    it('reports a null distro when the WSL host does not expose one', () => {
        expect(detectWslWorkspace('/home/u/repo', { isNativeWsl: true })).toEqual({ distro: null });
    });

    it('does not mark Windows drives reachable from a WSL host', () => {
        expect(detectWslWorkspace('/mnt/c/src/repo', { isNativeWsl: true, wslDistro: 'Ubuntu' })).toBeNull();
        expect(detectWslWorkspace(String.raw`C:\src\repo`, { isNativeWsl: true, wslDistro: 'Ubuntu' })).toBeNull();
    });

    it('returns null for empty input', () => {
        expect(detectWslWorkspace('')).toBeNull();
        expect(detectWslWorkspace(null)).toBeNull();
        expect(detectWslWorkspace(undefined)).toBeNull();
    });
});
