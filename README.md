# VSCode Extension Basic Setup

A basic VSCode extension template with TypeScript, webpack bundling, and testing infrastructure.

## Features

- TypeScript support with strict configuration
- Webpack bundling for optimized extension packaging
- Testing infrastructure with Mocha
- Debug configuration for Extension Development Host
- Basic "Hello World" command implementation

## Prerequisites

- [Node.js](https://nodejs.org/) (version 16 or higher)
- [VSCode](https://code.visualstudio.com/) (version 1.74.0 or higher)
- [VSCode Extension Manager (vsce)](https://github.com/microsoft/vscode-vsce) for packaging

## Setup

1. Clone or download this project
2. Install dependencies:
   ```bash
   npm install
   ```

## Development

### Running the Extension

1. Open the project in VSCode
2. Press `F5` or go to Run and Debug view and click "Run Extension"
3. This will open a new Extension Development Host window
4. In the new window, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
5. Type "Hello World" and run the command

### Building

- **Compile TypeScript**: `npm run compile`
- **Watch mode**: `npm run watch`
- **Package extension**: `npm run package`

### Testing

Run tests with:
```bash
npm test
```

### Debugging

The project includes debug configuration for VSCode:
- Press `F5` to launch Extension Development Host
- Set breakpoints in your TypeScript code
- Use the Debug Console for interactive debugging

## Project Structure

```
├── src/
│   ├── extension.ts          # Main extension entry point
│   └── test/
│       └── suite/
│           ├── index.ts      # Test suite configuration
│           └── extension.test.ts # Extension tests
├── .vscode/
│   ├── launch.json           # Debug configuration
│   ├── tasks.json            # Build tasks
│   └── settings.json         # Workspace settings
├── package.json              # Extension manifest
├── tsconfig.json             # TypeScript configuration
├── webpack.config.js         # Build configuration
└── README.md                 # This file
```

## Extension Commands

- `extension.helloWorld`: Displays a "Hello World" message

## Publishing

1. Install vsce globally: `npm install -g vsce`
2. Package the extension: `npm run package`
3. Publish to marketplace: `vsce publish`

## Contributing

1. Make your changes
2. Run tests: `npm test`
3. Build the extension: `npm run compile`
4. Test in Extension Development Host

## License

[MIT](LICENSE)