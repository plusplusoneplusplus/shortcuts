/**
 * Unit tests for elevation detection.
 *
 * `elevation.ts` keeps the OS probe and `geteuid` injectable, so every branch —
 * including the Windows ones — is asserted here under plain Node on any host
 * platform, with no spawned process and no Electron runtime.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    detectElevation,
    elevationText,
    elevationStatusLabel,
    elevationAboutLine,
    type ElevationState,
} from '../src/elevation';

/** Deps that would fail loudly if the wrong branch touched them. */
const unusedProbe = () => {
    throw new Error('windows probe must not run off win32');
};
const unusedGeteuid = () => {
    throw new Error('geteuid must not be read on win32');
};

describe('detectElevation on win32', () => {
    it('reports elevated when the admin probe exits 0', () => {
        const runWindowsProbe = vi.fn(() => ({ status: 0 }));
        expect(detectElevation('win32', { runWindowsProbe, geteuid: unusedGeteuid })).toBe(
            'elevated',
        );
        expect(runWindowsProbe).toHaveBeenCalledTimes(1);
    });

    it('reports standard when the admin probe exits non-zero (access denied)', () => {
        expect(
            detectElevation('win32', {
                runWindowsProbe: () => ({ status: 1 }),
                geteuid: unusedGeteuid,
            }),
        ).toBe('standard');
        expect(
            detectElevation('win32', {
                runWindowsProbe: () => ({ status: 5 }),
                geteuid: unusedGeteuid,
            }),
        ).toBe('standard');
    });

    it('reports unknown when the probe could not run at all', () => {
        expect(
            detectElevation('win32', {
                runWindowsProbe: () => ({ status: null }),
                geteuid: unusedGeteuid,
            }),
        ).toBe('unknown');
    });

    it('reports unknown when the probe throws instead of returning', () => {
        expect(
            detectElevation('win32', {
                runWindowsProbe: () => {
                    throw new Error('spawn ENOENT');
                },
                geteuid: unusedGeteuid,
            }),
        ).toBe('unknown');
    });
});

describe('detectElevation off win32', () => {
    it.each<NodeJS.Platform>(['darwin', 'linux'])('reports root as elevated on %s', (platform) => {
        expect(detectElevation(platform, { runWindowsProbe: unusedProbe, geteuid: () => 0 })).toBe(
            'elevated',
        );
    });

    it.each<NodeJS.Platform>(['darwin', 'linux'])(
        'reports a normal uid as standard on %s',
        (platform) => {
            expect(
                detectElevation(platform, { runWindowsProbe: unusedProbe, geteuid: () => 501 }),
            ).toBe('standard');
        },
    );

    it('reports unknown when geteuid is unavailable', () => {
        expect(
            detectElevation('linux', { runWindowsProbe: unusedProbe, geteuid: undefined }),
        ).toBe('unknown');
    });

    it('reports unknown when geteuid throws', () => {
        expect(
            detectElevation('darwin', {
                runWindowsProbe: unusedProbe,
                geteuid: () => {
                    throw new Error('nope');
                },
            }),
        ).toBe('unknown');
    });
});

describe('detectElevation defaults', () => {
    it('answers for the real host process without throwing', () => {
        // Whatever the CI platform is, detection must return a valid state and
        // must never bubble an error into bootstrap.
        const valid: ElevationState[] = ['elevated', 'standard', 'unknown'];
        expect(valid).toContain(detectElevation());
    });

    it('fills in only the missing deps when given a partial override', () => {
        // Passing just the probe on win32 must not fall through to geteuid.
        expect(detectElevation('win32', { runWindowsProbe: () => ({ status: 0 }) })).toBe(
            'elevated',
        );
    });
});

describe('elevationText', () => {
    it('uses Windows wording on win32', () => {
        expect(elevationText('win32', 'elevated')).toBe('Administrator');
        expect(elevationText('win32', 'standard')).toBe('Standard user');
    });

    it('uses POSIX wording elsewhere', () => {
        expect(elevationText('darwin', 'elevated')).toBe('Root');
        expect(elevationText('linux', 'standard')).toBe('Standard user');
    });

    it('renders the unknown state the same on every platform', () => {
        expect(elevationText('win32', 'unknown')).toBe('Unknown');
        expect(elevationText('linux', 'unknown')).toBe('Unknown');
    });
});

describe('elevationStatusLabel', () => {
    it('prefixes the status row label', () => {
        expect(elevationStatusLabel('win32', 'elevated')).toBe('Elevation: Administrator');
        expect(elevationStatusLabel('win32', 'standard')).toBe('Elevation: Standard user');
        expect(elevationStatusLabel('win32', 'unknown')).toBe('Elevation: Unknown');
        expect(elevationStatusLabel('darwin', 'elevated')).toBe('Elevation: Root');
    });
});

describe('elevationAboutLine', () => {
    it('always states the answer on Windows', () => {
        expect(elevationAboutLine('win32', 'elevated')).toBe('Running as administrator');
        expect(elevationAboutLine('win32', 'standard')).toBe('Running as standard user');
    });

    it('only mentions root elsewhere', () => {
        expect(elevationAboutLine('darwin', 'elevated')).toBe('Running as root');
        expect(elevationAboutLine('linux', 'elevated')).toBe('Running as root');
        expect(elevationAboutLine('darwin', 'standard')).toBeUndefined();
        expect(elevationAboutLine('linux', 'standard')).toBeUndefined();
    });

    it('omits the line when the state is unknown', () => {
        expect(elevationAboutLine('win32', 'unknown')).toBeUndefined();
        expect(elevationAboutLine('linux', 'unknown')).toBeUndefined();
    });
});
