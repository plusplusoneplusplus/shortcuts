import { useDisplaySettings } from '../preferences/useDisplaySettings';

export function useMyWorkEnabled(): boolean {
    return useDisplaySettings().myWorkEnabled;
}
