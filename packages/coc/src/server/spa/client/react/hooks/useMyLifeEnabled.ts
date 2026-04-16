import { useDisplaySettings } from './useDisplaySettings';

export function useMyLifeEnabled(): boolean {
    return useDisplaySettings().myLifeEnabled;
}
