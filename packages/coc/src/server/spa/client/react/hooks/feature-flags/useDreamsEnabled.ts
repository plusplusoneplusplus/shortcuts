import { useDisplaySettings } from '../preferences/useDisplaySettings';

export function useDreamsEnabled(): boolean {
    return useDisplaySettings().dreamsEnabled;
}
