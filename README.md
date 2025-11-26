# OpenAI App SDK

A TypeScript SDK for building OpenAI Apps with widgets, tools, and HTTP endpoints.

## Flow

The SDK follows this development flow:

1. **Create server** - Initialize the OpenAI App server
2. **Register widget** - Add widgets to your app
3. **Register tools** - Add tools/actions that your app can use
4. **Connect to HTTP (local)** - Start the local server
5. **(Later) Make public** - Expose with ngrok or alpic

## Installation

```bash
npm install
```

## Quick Start

```typescript
import { OpenAIServer } from './src/index.js';

// Step 1: Create server
const server = new OpenAIServer({
  port: 3000,
  host: 'localhost',
  cors: true,
});

// Step 2: Register widget
server.getWidgetRegistry().register({
  id: 'my-widget',
  name: 'My Widget',
  description: 'A custom widget',
  url: 'http://localhost:3000/widgets/my-widget',
});

// Step 3: Register tools
server.getToolRegistry().register({
  id: 'my_tool',
  name: 'My Tool',
  description: 'A custom tool',
  inputSchema: {
    type: 'object',
    properties: {
      input: { type: 'string' },
    },
    required: ['input'],
  },
  handler: async (params) => {
    return { result: `Processed: ${params.input}` };
  },
});

// Step 4: Connect to HTTP (local)
await server.start();
```

## Development

```bash
# Run in development mode (with hot reload)
npm run dev

# Build
npm run build

# Run production build
npm start
```

## Example

See `src/example.ts` for a complete example.

```bash
npm run dev src/example.ts
```

## API Endpoints

Once the server is running, the following endpoints are available:

- `GET /health` - Health check
- `GET /widgets` - List all registered widgets
- `GET /widgets/:id` - Get a specific widget
- `GET /tools` - List all registered tools (OpenAI Actions format)
- `POST /tools/:id/execute` - Execute a tool
- `GET /.well-known/openai-actions` - Complete manifest for OpenAI App
- `POST /mcp` - **MCP Server endpoint** - Handles MCP protocol requests:
  - `tools/list` - List all available tools
  - `tools/call` - Execute a tool
  - `resources/list` - List all available resources (widgets)
  - `resources/read` - Read a specific resource

## Making Your App Public

### Using ngrok

```bash
# Install ngrok
npm install -g ngrok

# Expose your local server
ngrok http 3000
```

Then use the ngrok URL (e.g., `https://abc123.ngrok.io`) in your OpenAI App configuration.

### Using alpic

```bash
# Install alpic
npm install -g alpic

# Expose your local server
alpic http://localhost:3000
```

## Project Structure

```
src/
  ├── index.ts          # Main entry point
  ├── Server.ts         # Server class
  ├── WidgetRegistry.ts # Widget management
  ├── ToolRegistry.ts   # Tool management
  ├── types.ts          # TypeScript types
  └── example.ts        # Example usage
```

## License

MIT

