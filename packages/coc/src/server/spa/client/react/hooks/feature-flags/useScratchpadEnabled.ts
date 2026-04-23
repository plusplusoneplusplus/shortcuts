import { useDisplaySettings } from '../preferences/useDisplaySettings';

export function useScratchpadEnabled(): boolean {
    return useDisplaySettings().scratchpadEnabled;
}
