//@ts-check

'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

//@ts-check
/** @typedef {import('webpack').Configuration} WebpackConfig **/

/** @type WebpackConfig */
const extensionConfig = {
  name: 'extension',
  target: 'node', // VSCode extensions run in a Node.js-context 📖 -> https://webpack.js.org/configuration/node/
  mode: 'none', // this leaves the source code as close as possible to the original (when packaging we set this to 'production')

  entry: './src/extension.ts', // the entry point of this extension, 📖 -> https://webpack.js.org/configuration/entry-context/
  output: {
    // the bundle is stored in the 'dist' folder (check package.json), 📖 -> https://webpack.js.org/configuration/output/
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  externals: {
    vscode: 'commonjs vscode' // the vscode-module is created on-the-fly and must be excluded. Add other modules that cannot be webpack'ed, 📖 -> https://webpack.js.org/configuration/externals/
    // modules added here also need to be added in the .vscodeignore file
  },
  resolve: {
    // support reading TypeScript and JavaScript files, 📖 -> https://github.com/TypeStrong/ts-loader
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /src\/test/, /webview-scripts/, /webview-logic/],
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, 'tsconfig.webpack.json'),
              // Use separate instance to avoid config mixing
              instance: 'extension',
              // Skip type checking - use tsc for that
              transpileOnly: true
            }
          }
        ]
      }
    ]
  },
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: "log", // enables logging required for problem matchers
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: 'resources/bundled-pipelines',
          to: 'resources/bundled-pipelines'
        }
      ]
    })
  ]
};

/** @type WebpackConfig */
const webviewConfig = {
  name: 'webview',
  target: 'web', // Webview runs in a browser-like context
  mode: 'none',

  entry: './src/shortcuts/markdown-comments/webview-scripts/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'webview.js',
    // IIFE format - script runs immediately without needing exports
    iife: true
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /src\/test/],
        use: [
          {
            loader: 'ts-loader',
            options: {
              // Use separate tsconfig with DOM types for webview
              configFile: path.resolve(__dirname, 'tsconfig.webview.json'),
              // Use separate instance to avoid config mixing
              instance: 'webview'
            }
          }
        ]
      }
    ]
  },
  devtool: 'source-map', // Full source maps for webview debugging
  // Don't split chunks for webview - we want a single file
  optimization: {
    splitChunks: false
  }
};

/** @type WebpackConfig */
const diffWebviewConfig = {
  name: 'diff-webview',
  target: 'web', // Webview runs in a browser-like context
  mode: 'none',

  entry: './src/shortcuts/git-diff-comments/webview-scripts/main.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'diff-webview.js',
    // IIFE format - script runs immediately without needing exports
    iife: true
  },
  resolve: {
    extensions: ['.ts', '.js']
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: [/node_modules/, /src\/test/],
        use: [
          {
            loader: 'ts-loader',
            options: {
              // Use separate tsconfig with DOM types for webview
              configFile: path.resolve(__dirname, 'tsconfig.webview.json'),
              // Use separate instance to avoid config mixing
              instance: 'diff-webview'
            }
          }
        ]
      }
    ]
  },
  devtool: 'source-map', // Full source maps for webview debugging
  // Don't split chunks for webview - we want a single file
  optimization: {
    splitChunks: false
  }
};

module.exports = [extensionConfig, webviewConfig, diffWebviewConfig];
