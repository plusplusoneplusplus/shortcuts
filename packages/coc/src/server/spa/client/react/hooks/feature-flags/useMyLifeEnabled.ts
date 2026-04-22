import { useDisplaySettings } from '../preferences/useDisplaySettings';

export function useMyLifeEnabled(): boolean {
    return useDisplaySettings().myLifeEnabled;
}
