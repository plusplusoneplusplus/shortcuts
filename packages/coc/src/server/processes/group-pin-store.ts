import * as fs from 'fs';
import { isGroupPinType, type ProcessGroupPinType } from '@plusplusoneplusplus/coc-client';
import { atomicWriteJson } from '../shared/fs-utils';
import { getRepoDataPath } from '../paths';

// Pin types are sourced from the shared task-group registry in coc-client so a
// new group kind (e.g. dream-run) becomes pinnable without editing this file.
export { GROUP_PIN_TYPES, isGroupPinType } from '@plusplusoneplusplus/coc-client';

export type GroupPinType = ProcessGroupPinType;

export interface GroupPin {
    type: GroupPinType;
    groupId: string;
    pinnedAt: string;
}

interface GroupPinState {
    version: 1;
    workspaceId: string;
    updatedAt: string;
    pins: GroupPin[];
}

const GROUP_PINS_FILE = 'group-pins.json';

export function normalizeGroupId(groupId: unknown): string | undefined {
    if (typeof groupId !== 'string') return undefined;
    const trimmed = groupId.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}

export class GroupPinStore {
    constructor(private readonly dataDir: string) {}

    listPins(workspaceId: string): GroupPin[] {
        return sortPins(this.readState(workspaceId).pins);
    }

    setPin(workspaceId: string, type: GroupPinType, groupId: string, pinnedAt: string): GroupPin {
        const state = this.readState(workspaceId);
        const pin: GroupPin = { type, groupId, pinnedAt };
        const index = state.pins.findIndex(existing => existing.type === type && existing.groupId === groupId);
        if (index >= 0) {
            state.pins[index] = pin;
        } else {
            state.pins.push(pin);
        }
        this.writeState(workspaceId, {
            ...state,
            updatedAt: pinnedAt,
            pins: sortPins(state.pins),
        });
        return pin;
    }

    clearPin(workspaceId: string, type: GroupPinType, groupId: string, updatedAt: string): void {
        const state = this.readState(workspaceId);
        const pins = state.pins.filter(pin => pin.type !== type || pin.groupId !== groupId);
        this.writeState(workspaceId, {
            ...state,
            updatedAt,
            pins: sortPins(pins),
        });
    }

    private statePath(workspaceId: string): string {
        return getRepoDataPath(this.dataDir, workspaceId, GROUP_PINS_FILE);
    }

    private readState(workspaceId: string): GroupPinState {
        const filePath = this.statePath(workspaceId);
        if (!fs.existsSync(filePath)) {
            return emptyState(workspaceId);
        }

        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<GroupPinState>;
        if (parsed.workspaceId !== workspaceId) {
            throw new Error(`Group pin state workspace mismatch for ${workspaceId}`);
        }
        if (!Array.isArray(parsed.pins)) {
            throw new Error(`Invalid group pin state for ${workspaceId}`);
        }

        return {
            version: 1,
            workspaceId,
            updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
            pins: parsed.pins.map(validatePin),
        };
    }

    private writeState(workspaceId: string, state: GroupPinState): void {
        atomicWriteJson(this.statePath(workspaceId), state);
    }
}

function emptyState(workspaceId: string): GroupPinState {
    return {
        version: 1,
        workspaceId,
        updatedAt: '',
        pins: [],
    };
}

function validatePin(value: unknown): GroupPin {
    if (!value || typeof value !== 'object') {
        throw new Error('Invalid group pin entry');
    }
    const pin = value as Partial<GroupPin>;
    if (!isGroupPinType(pin.type)) {
        throw new Error('Invalid group pin type');
    }
    const groupId = normalizeGroupId(pin.groupId);
    if (!groupId) {
        throw new Error('Invalid group pin groupId');
    }
    if (typeof pin.pinnedAt !== 'string' || pin.pinnedAt.trim().length === 0) {
        throw new Error('Invalid group pin pinnedAt');
    }
    return {
        type: pin.type,
        groupId,
        pinnedAt: pin.pinnedAt,
    };
}

function sortPins(pins: GroupPin[]): GroupPin[] {
    return [...pins].sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt));
}
