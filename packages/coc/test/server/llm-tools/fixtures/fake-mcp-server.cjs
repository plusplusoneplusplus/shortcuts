// Fake MCP server for mcp-script-tools tests. Run directly it serves over
// stdio; required, it exports a factory for the HTTP tests.
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

const TOOLS = [
    { name: 'echo', description: 'Echo the text back', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    { name: 'pid', description: 'Return the server process id', inputSchema: { type: 'object' } },
    { name: 'fail', description: 'Always fails', inputSchema: { type: 'object' } },
    { name: 'secret', description: 'A tool tests filter out', inputSchema: { type: 'object' } },
];

function createFakeMcpServer() {
    const server = new Server({ name: 'fake-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        if (name === 'echo') return { content: [{ type: 'text', text: `echo:${args && args.text}` }] };
        if (name === 'pid') return { content: [{ type: 'text', text: String(process.pid) }] };
        if (name === 'secret') return { content: [{ type: 'text', text: 'secret' }] };
        return { isError: true, content: [{ type: 'text', text: `boom from ${name}` }] };
    });
    return server;
}

module.exports = { createFakeMcpServer };

if (require.main === module) {
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
    createFakeMcpServer().connect(new StdioServerTransport());
}
