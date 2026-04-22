import { useDisplaySettings } from '../../../hooks/preferences/useDisplaySettings';

export function useNotesEnabled(): boolean {
    return useDisplaySettings().notesEnabled;
}
