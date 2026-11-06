'use strict';
const path = require('node:path');

function installDownloadChooser(dialog, directory) {
    const destination = path.join(directory, 'fixture.zip');
    dialog.showSaveDialog = async (_window, options) => {
        if (options.title !== 'Save browser download' || options.defaultPath !== destination) {
            throw new Error('Unexpected browser download chooser.');
        }
        return { canceled: false, filePath: destination };
    };
}

function completedDownload(result, engine) {
    if (!result.ok || !result.engines[engine]?.managed) {
        throw new Error(`Managed ${engine} downloads are unavailable.`);
    }
    return result.entries.find(entry => entry.engine === engine && entry.filename === 'fixture.zip'
        && entry.state === 'completed' && entry.fileAvailable);
}

module.exports = { installDownloadChooser, completedDownload };
