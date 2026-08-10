const base = require('./package.json').build;

module.exports = {
    ...base,
    appId: 'com.plusplusoneplusplus.coccontainer',
    productName: 'CoCContainer',
    artifactName: 'CoCContainer.Setup.${version}.${ext}',
    extraMetadata: {
        main: 'dist/container-main.js',
    },
    files: [
        ...base.files,
        'node_modules/@plusplusoneplusplus/coccontainer/dist/**/*',
    ],
    nsis: {
        ...base.nsis,
        shortcutName: 'CoCContainer',
    },
};
