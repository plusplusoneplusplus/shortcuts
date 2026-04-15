import { useDisplaySettings } from './useDisplaySettings';

export function useMyWorkEnabled(): boolean {
    return useDisplaySettings().myWorkEnabled;
}
