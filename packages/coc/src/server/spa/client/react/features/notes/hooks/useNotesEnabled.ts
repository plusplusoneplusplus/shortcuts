import { useDisplaySettings } from '../../../hooks/useDisplaySettings';

export function useNotesEnabled(): boolean {
    return useDisplaySettings().notesEnabled;
}
