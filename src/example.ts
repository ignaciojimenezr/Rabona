/**
 * Example usage of the OpenAI App SDK
 * 
 * This demonstrates the complete flow:
 * 1. Create server
 * 2. Register widget
 * 3. Register tools
 * 4. Connect to HTTP (local)
 */

import { OpenAIServer } from './index.js';

async function main() {
  // Step 1: Create server
  const server = new OpenAIServer({
    port: 3000,
    host: 'localhost',
    cors: true,
  });

  // Step 2: Register widget (optional - only if you have widgets)
  // server.getWidgetRegistry().register({
  //   id: 'my-widget',
  //   name: 'My Widget',
  //   description: 'A custom widget',
  //   url: 'http://localhost:3000/widgets/my-widget',
  // });

  // Step 3: Register tools (optional - only if you have tools)
  // server.getToolRegistry().register({
  //   id: 'my_tool',
  //   name: 'My Tool',
  //   description: 'A custom tool',
  //   inputSchema: {
  //     type: 'object',
  //     properties: {
  //       input: { type: 'string' },
  //     },
  //     required: ['input'],
  //   },
  //   handler: async (params) => {
  //     return { result: `Processed: ${params.input}` };
  //   },
  // });

  // Step 4: Connect to HTTP (local)
  await server.start();

  console.log('\n✅ Server is ready!');
  console.log('📝 Next steps:');
  console.log('   1. Register your widgets and tools');
  console.log('   2. Test endpoints: http://localhost:3000/health');
  console.log('   3. View widgets: http://localhost:3000/widgets');
  console.log('   4. View tools: http://localhost:3000/tools');
  console.log('   5. MCP endpoint: http://localhost:3000/mcp');
  console.log('   6. Make public with ngrok: ngrok http 3000');
  console.log('   7. Or use alpic: alpic http://localhost:3000\n');
}

// Run example
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

