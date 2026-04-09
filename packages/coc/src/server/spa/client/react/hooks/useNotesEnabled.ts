import { useDisplaySettings } from './useDisplaySettings';

export function useNotesEnabled(): boolean {
    return useDisplaySettings().notesEnabled;
}
