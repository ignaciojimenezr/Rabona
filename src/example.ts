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

  // Step 2: Register widget
  server.getWidgetRegistry().register({
    id: 'tic-tac-soccer',
    name: 'Tic Tac Soccer Game',
    description: 'Play tic-tac-toe with soccer players',
    url: 'http://localhost:3000/game.html',
    width: 800,
    height: 600,
  });

  // Step 3: Register tools for MCP Jam
  // These tools will be available in MCP Jam for testing
  const gameEngine = server.getGameEngine();
  const activeGames = server.getActiveGames();
  const squadStore = server.getSquadStore();

  server.getToolRegistry().register({
    id: 'create_game',
    name: 'Create Game',
    description: 'Create a new tic-tac-toe game with soccer players',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const game = gameEngine.generateGame();
      activeGames.set(game.id, game);
      return game;
    },
  });

  server.getToolRegistry().register({
    id: 'get_game',
    name: 'Get Game',
    description: 'Get the current state of a game',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: {
          type: 'string',
          description: 'The game ID',
        },
      },
      required: ['gameId'],
    },
    handler: async (params) => {
      const game = activeGames.get(params.gameId);
      if (!game) {
        throw new Error(`Game ${params.gameId} not found`);
      }
      return game;
    },
  });

  server.getToolRegistry().register({
    id: 'make_move',
    name: 'Make Move',
    description: 'Make a move in the game (place O on a player that matches the row category)',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: {
          type: 'string',
          description: 'The game ID',
        },
        row: {
          type: 'number',
          description: 'Row index (0-2)',
        },
        col: {
          type: 'number',
          description: 'Column index (1-2, column 0 is categories)',
        },
      },
      required: ['gameId', 'row', 'col'],
    },
    handler: async (params) => {
      const game = activeGames.get(params.gameId);
      if (!game) {
        throw new Error(`Game ${params.gameId} not found`);
      }
      const result = gameEngine.makeUserMove(game, params.row, params.col);
      if (result.success) {
        activeGames.set(game.id, result.game);
        return result.game;
      }
      throw new Error(result.message || 'Invalid move');
    },
  });

  server.getToolRegistry().register({
    id: 'ai_move',
    name: 'AI Move',
    description: 'Have the AI make a move (places X)',
    inputSchema: {
      type: 'object',
      properties: {
        gameId: {
          type: 'string',
          description: 'The game ID',
        },
      },
      required: ['gameId'],
    },
    handler: async (params) => {
      const game = activeGames.get(params.gameId);
      if (!game) {
        throw new Error(`Game ${params.gameId} not found`);
      }
      const result = gameEngine.makeAIMove(game);
      if (result.success) {
        activeGames.set(game.id, result.game);
        return result.game;
      }
      throw new Error(result.message || 'AI move failed');
    },
  });

  server.getToolRegistry().register({
    id: 'search_players',
    name: 'Search Players',
    description: 'Search for players by team, country, position, or league',
    inputSchema: {
      type: 'object',
      properties: {
        team: { type: 'string', description: 'Filter by team name' },
        country: { type: 'string', description: 'Filter by country' },
        position: { type: 'string', description: 'Filter by position (GK, DF, MF, FW)' },
        league: { type: 'string', description: 'Filter by league' },
      },
      required: [],
    },
    handler: async (params) => {
      const players = squadStore.search(params);
      return { count: players.length, players };
    },
  });

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

