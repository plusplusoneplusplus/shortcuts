/**
 * Compatibility shim — the editor itself now lives in
 * `shared/file-viewer/MonacoFileEditor`, neutral ground shared by the Explorer
 * preview pane and the chat source canvas (AC-02). This path is kept so the
 * existing import sites (and the tests that module-mock them) keep working.
 */
export * from '../../../shared/file-viewer/MonacoFileEditor';
