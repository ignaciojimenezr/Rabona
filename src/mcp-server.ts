/**
 * MCP Server using official OpenAI Apps SDK
 * Following OpenAI's quickstart guide: https://developers.openai.com/apps-sdk/quickstart
 */

import express from "express";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { GameEngine } from "./GameEngine.js";
import { SquadStore } from "./SquadStore.js";
import type { PlayerRecord } from "./types.js";

// Cache widget HTML to avoid reloading on every request (performance optimization)
let cachedGameHtml: string | null = null;
let lastHtmlLoadTime: number = 0;
const HTML_CACHE_TTL = 5000; // Cache for 5 seconds (balance between performance and hot-reload)

// Function to load widget HTML and embed images as base64 data URIs
// HTML is cached for 5 seconds to improve performance while still allowing hot-reload
function loadGameHtml(): string {
  const now = Date.now();
  
  // Return cached HTML if still valid
  if (cachedGameHtml && (now - lastHtmlLoadTime) < HTML_CACHE_TTL) {
    return cachedGameHtml;
  }
  
  // Reload HTML file
  let gameHtml = readFileSync("public/game-widget.html", "utf8");
  
  // Get server URL from environment or default to localhost:3000
  const serverPort = Number(process.env.PORT ?? 3000);
  const serverHost = process.env.HOST ?? 'localhost';
  const serverUrl = `http://${serverHost}:${serverPort}`;
  
  // Inject image data URIs and server URL into HTML as a JavaScript object
  const imageDataScript = `
    <script>
      window.IMAGE_DATA_URIS = ${JSON.stringify(Object.fromEntries(imageDataUris))};
      window.MCP_SERVER_URL = ${JSON.stringify(serverUrl)};
    </script>
  `;
  // Insert before the first <script> tag to ensure it loads before the module script
  const scriptMatch = gameHtml.match(/<script[^>]*>/);
  if (scriptMatch) {
    gameHtml = gameHtml.replace(scriptMatch[0], imageDataScript + scriptMatch[0]);
  } else if (gameHtml.includes('</head>')) {
    gameHtml = gameHtml.replace('</head>', imageDataScript + '</head>');
  } else if (gameHtml.includes('<body')) {
    gameHtml = gameHtml.replace('<body', imageDataScript + '<body');
  } else {
    gameHtml = imageDataScript + gameHtml;
  }
  
  // Cache the processed HTML
  cachedGameHtml = gameHtml;
  lastHtmlLoadTime = now;
  
  return gameHtml;
}

// Helper to get MIME type from file extension
function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'gif': 'image/gif',
  };
  return mimeTypes[ext || ''] || 'application/octet-stream';
}

// Create a map of image names to data URIs
const imageDataUris: Map<string, string> = new Map();
const imagesDir = "public/images";
try {
  const imageFiles = readdirSync(imagesDir);
  for (const imageFile of imageFiles) {
    const imagePath = join(imagesDir, imageFile);
    const imageData = readFileSync(imagePath);
    const base64Data = imageData.toString('base64');
    const mimeType = getMimeType(imageFile);
    const dataUri = `data:${mimeType};base64,${base64Data}`;
    imageDataUris.set(imageFile, dataUri);
  }
  console.log(`✓ Loaded ${imageFiles.length} images as data URIs`);
} catch (error) {
  console.error('Error loading images:', error);
}

// Game state storage (in-memory for now)
const activeGames = new Map();
let gameEngine: GameEngine;
let squadStore: SquadStore;

// Initialize stores
squadStore = new SquadStore();
gameEngine = new GameEngine(squadStore);

const createGameInputSchema = z.object({});
const getGameInputSchema = z.object({
  gameId: z.string().min(1),
});
const makeMoveInputSchema = z.object({
  gameId: z.string().min(1),
  row: z.number().int().min(1).max(3), // Rows 1-3 (row 0 is header)
  col: z.number().int().min(1).max(3), // Cols 1-3 (col 0 is category)
});
const aiMoveInputSchema = z.object({
  gameId: z.string().min(1),
});
const guessPlayerInputSchema = z.object({
  gameId: z.string().min(1),
  row: z.number().int().min(1).max(3),
  col: z.number().int().min(1).max(3),
  playerName: z.string().min(1),
});
const skipTurnInputSchema = z.object({
  gameId: z.string().min(1),
});
const searchPlayersInputSchema = z.object({
  team: z.string().optional(),
  country: z.string().optional(),
  position: z.string().optional(),
  league: z.string().optional(),
});

// Helper to create tool response with game state for widget
// This ensures widget state is properly updated through structured content
// Helper to create tool response with game state for widget
// Per Apps SDK: empty content array keeps widget visible, structuredContent updates widget state
const replyWithGame = (message: string, game: any) => {
  // OpenAI Apps SDK automatically updates widget state from structured content
  // Return empty content array to keep widget visible (text content causes widget to disappear)
  return {
    content: [], // Empty content keeps widget visible
    structuredContent: { 
      game,
      // Widget state will be updated from structuredContent.game
    },
  };
};

function createMcpServer() {
  const server = new McpServer({
    name: "tic-tac-soccer",
    version: "1.0.0",
  });

  // Register widget resource (with embedded image data URIs)
  // Reload HTML on each request so changes are picked up without server restart
  server.registerResource(
    "game-widget",
    "ui://widget/game-widget.html",
    {},
    async () => {
      const gameHtml = loadGameHtml();
      return {
        contents: [
          {
            uri: "ui://widget/game-widget.html",
            mimeType: "text/html+skybridge",
            text: gameHtml,
            _meta: { "openai/widgetPrefersBorder": true },
          },
        ],
      };
    }
  );

  // Register create_game tool
  server.registerTool(
    "create_game",
    {
      title: "Create Game",
      description: "Creates a new tic-tac-toe game with soccer players.",
      inputSchema: createGameInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/game-widget.html",
        "openai/toolInvocation/invoking": "Creating new game...",
        "openai/toolInvocation/invoked": "Game created!",
      },
    },
    async (args) => {
      const game = gameEngine.generateGame();
      activeGames.set(game.id, game);
      return replyWithGame(`Created new game: ${game.id}`, game);
    }
  );

  // Register get_game tool
  server.registerTool(
    "get_game",
    {
      title: "Get Game",
      description: "Gets the current state of a game.",
      inputSchema: getGameInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/game-widget.html",
      },
    },
    async (args) => {
      const game = activeGames.get(args.gameId);
      if (!game) {
        // Return empty content to keep widget visible
        return {
          content: [],
          structuredContent: { error: `Game ${args.gameId} not found.` },
        };
      }
      return replyWithGame("", game);
    }
  );

  // Register make_move tool
  server.registerTool(
    "make_move",
    {
      title: "Make Move",
      description:
        "Makes a move in the game (place O on a player that matches the row category).",
      inputSchema: makeMoveInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/game-widget.html",
        "openai/toolInvocation/invoking": "Making move...",
        "openai/toolInvocation/invoked": "Move made!",
      },
    },
    async (args) => {
      const game = activeGames.get(args.gameId);
      if (!game) {
        return {
          content: [],
          structuredContent: { error: `Game ${args.gameId} not found.` },
        };
      }

      const result = gameEngine.makeUserMove(game, args.row, args.col);
      if (result.success) {
        activeGames.set(game.id, result.game);
        return replyWithGame("", result.game);
      }
      // Return game state even on error to keep widget visible
      return {
        content: [],
        structuredContent: { 
          game: result.game || game,
          error: result.message || "Invalid move"
        },
      };
    }
  );

  // Register ai_move tool
  server.registerTool(
    "ai_move",
    {
      title: "AI Move",
      description: "Has the AI make a move (places X).",
      inputSchema: aiMoveInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/game-widget.html",
        "openai/toolInvocation/invoking": "AI is thinking...",
        "openai/toolInvocation/invoked": "AI made a move!",
      },
    },
    async (args) => {
      const game = activeGames.get(args.gameId);
      if (!game) {
        return {
          content: [],
          structuredContent: { error: `Game ${args.gameId} not found.` },
        };
      }

      const result = gameEngine.makeAIMove(game);
      if (result.success) {
        activeGames.set(game.id, result.game);
        return replyWithGame("", result.game);
      }
      // Return game state even on error to keep widget visible
      return {
        content: [],
        structuredContent: { 
          game: result.game || game,
          error: result.message || "AI move failed"
        },
      };
    }
  );

  // Register guess_player tool
  server.registerTool(
    "guess_player",
    {
      title: "Guess Player",
      description: "Guess a player name for a specific cell in the game.",
      inputSchema: guessPlayerInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/game-widget.html",
        "openai/toolInvocation/invoking": "Checking guess...",
        "openai/toolInvocation/invoked": "Guess processed!",
      },
    },
    async (args) => {
      const game = activeGames.get(args.gameId);
      if (!game) {
        return {
          content: [],
          structuredContent: { error: `Game ${args.gameId} not found.` },
        };
      }

      const result = gameEngine.guessPlayer(game, args.row, args.col, args.playerName);
      activeGames.set(game.id, result.game);
      
      if (result.success) {
        // If game is not complete, add a delay before AI makes its move
        // This makes the AI feel less automatic and more natural
        if (!result.game.isComplete && result.game.currentTurn === 'ai') {
          // Wait up to 1 second before AI move
          await new Promise(resolve => setTimeout(resolve, Math.random() * 1000)); // 0-1 second
          
          // Make AI move after delay
          const aiResult = gameEngine.makeAIMove(result.game);
          activeGames.set(aiResult.game.id, aiResult.game);
          return replyWithGame("", aiResult.game);
        }
        return replyWithGame("", result.game);
      }
      return replyWithGame("", result.game);
    }
  );

  // Register skip_turn tool
  server.registerTool(
    "skip_turn",
    {
      title: "Skip Turn",
      description: "Skip your turn and let the AI make a move.",
      inputSchema: skipTurnInputSchema,
      _meta: {
        "openai/outputTemplate": "ui://widget/game-widget.html",
        "openai/toolInvocation/invoking": "Skipping turn...",
        "openai/toolInvocation/invoked": "Turn skipped!",
      },
    },
    async (args) => {
      const game = activeGames.get(args.gameId);
      if (!game) {
        return {
          content: [],
          structuredContent: { error: `Game ${args.gameId} not found.` },
        };
      }

      if (game.isComplete) {
        return replyWithGame("", game);
      }

      if (game.currentTurn !== 'user') {
        return replyWithGame("", game);
      }

      // Switch turn to AI before making move
      const gameWithAITurn = { ...game, currentTurn: 'ai' as const };
      const result = gameEngine.makeAIMove(gameWithAITurn);
      if (result.success) {
        activeGames.set(game.id, result.game);
        return replyWithGame("", result.game);
      }
      // Return game state even on error to keep widget visible
      return {
        content: [],
        structuredContent: { 
          game: result.game || game,
          error: result.message || "AI move failed"
        },
      };
    }
  );

  // Register search_players tool
  server.registerTool(
    "search_players",
    {
      title: "Search Players",
      description: "Search for players by team, country, position, or league.",
      inputSchema: searchPlayersInputSchema,
    },
    async (args) => {
      // Map lowercase args to PlayerRecord field names
      const filters: Partial<PlayerRecord> = {};
      if (args.team) filters.Team = args.team;
      if (args.country) filters.Country = args.country;
      if (args.position) filters.Position = args.position;
      if (args.league) filters.League = args.league;
      
      const players = squadStore.search(filters);
      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${players.length} players matching your criteria.`,
          },
        ],
        structuredContent: { players },
      };
    }
  );

  return server;
}

const port = Number(process.env.PORT ?? 3000);
const MCP_PATH = "/mcp";

// Create a single MCP server instance (reused across requests)
const mcpServer = createMcpServer();

const app = express();
app.use(express.json());

// Health check
app.get("/", (_req, res) => {
  res.send("Tic Tac Soccer MCP server");
});

// Debug middleware to log all requests (placed early to catch everything)
app.use((req, res, next) => {
  // Log all requests to adapter, link, or manifest endpoints
  if (req.path.includes('adapter-http') || req.path.includes('link_') || req.path.includes('openai-actions') || req.path.includes('api/mcp')) {
    console.log(`🔍 [${new Date().toISOString()}] ${req.method} ${req.path}`);
    if (Object.keys(req.body || {}).length > 0) {
      console.log(`   Body:`, JSON.stringify(req.body, null, 2));
    }
    if (Object.keys(req.query || {}).length > 0) {
      console.log(`   Query:`, JSON.stringify(req.query, null, 2));
    }
  }
  next();
});

// Players endpoint for autocomplete
app.get("/players", (_req, res) => {
  // Set CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  const players = squadStore.getAll();
  res.json({ count: players.length, players });
});

// MCP endpoint handler (reusable for POST, GET, DELETE)
const handleMcpRequest = async (req: express.Request, res: express.Response) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");

  // Ensure Accept header includes both required types for MCP protocol
  const acceptHeader = req.headers.accept || "";
  if (!acceptHeader.includes("application/json") || !acceptHeader.includes("text/event-stream")) {
    req.headers.accept = "application/json, text/event-stream";
  }

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close();
  });

  try {
    // Log incoming requests for debugging
    if (req.body?.method) {
      console.log(`📥 MCP request: ${req.body.method} (id: ${req.body.id})`);
    }
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("❌ Error handling MCP request:", error);
    if (req.body?.method) {
      console.error(`   Failed method: ${req.body.method}`);
    }
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
        },
        id: null,
      });
    }
  }
};

// Handle POST requests (JSON-RPC)
app.post(MCP_PATH, handleMcpRequest);

// Handle GET requests (SSE for server-to-client notifications)
app.get(MCP_PATH, handleMcpRequest);

// Handle DELETE requests (session termination)
app.delete(MCP_PATH, handleMcpRequest);

// Handle CORS preflight
app.options(MCP_PATH, (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.sendStatus(204);
});

// OpenAI App adapter HTTP endpoint format
// OpenAI Apps use: /api/mcp/adapter-http/{app-name}
// This endpoint handles MCP protocol requests from ChatGPT
const OPENAI_ADAPTER_PATH = "/api/mcp/adapter-http/:appName";

// Handle OpenAI App adapter format (POST, GET, DELETE)
// ChatGPT sends MCP protocol requests to this endpoint
const handleAdapterRequest = async (req: express.Request, res: express.Response) => {
  // Log the request for debugging
  const { appName } = req.params;
  console.log(`📥 Adapter request: ${req.method} ${req.path} (app: ${appName})`);
  console.log(`   Body:`, JSON.stringify(req.body, null, 2));
  console.log(`   Query:`, JSON.stringify(req.query, null, 2));
  
  // Ensure body exists and is in correct format for MCP
  // If body is empty or not in MCP format, ChatGPT might be sending a different format
  if (!req.body || Object.keys(req.body).length === 0) {
    console.log(`⚠️ Empty body, returning 400`);
    return res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32600,
        message: "Invalid Request: Empty body",
      },
      id: null,
    });
  }
  
  // The adapter endpoint should handle MCP protocol requests
  // Pass it through to the MCP handler
  await handleMcpRequest(req, res);
};

app.post(OPENAI_ADAPTER_PATH, handleAdapterRequest);
app.get(OPENAI_ADAPTER_PATH, handleAdapterRequest);
app.delete(OPENAI_ADAPTER_PATH, handleAdapterRequest);

// Handle CORS preflight for adapter path
app.options(OPENAI_ADAPTER_PATH, (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "content-type, mcp-session-id");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.sendStatus(204);
});

// OpenAI Actions manifest endpoint (required for ChatGPT to discover tools)
// ChatGPT calls this endpoint to discover available tools and widgets
app.get("/.well-known/openai-actions", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  
  // Get server URL from environment or use default
  // This should be the base URL where the server is accessible (e.g., ngrok URL in production)
  const serverUrl = process.env.SERVER_URL || `http://localhost:${port}`;
  
  // Define tools in OpenAI Actions format
  const tools = [
    {
      type: "function",
      function: {
        name: "create_game",
        description: "Creates a new tic-tac-toe game with soccer players.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_game",
        description: "Gets the current state of a game.",
        parameters: {
          type: "object",
          properties: {
            gameId: {
              type: "string",
              description: "The ID of the game to retrieve",
            },
          },
          required: ["gameId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "make_move",
        description: "Makes a move in the game (place O on a player that matches the row category).",
        parameters: {
          type: "object",
          properties: {
            gameId: { type: "string" },
            row: { type: "number", minimum: 1, maximum: 3 },
            col: { type: "number", minimum: 1, maximum: 3 },
          },
          required: ["gameId", "row", "col"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "guess_player",
        description: "Guess a player name for a specific cell in the game.",
        parameters: {
          type: "object",
          properties: {
            gameId: { type: "string" },
            row: { type: "number", minimum: 1, maximum: 3 },
            col: { type: "number", minimum: 1, maximum: 3 },
            playerName: { type: "string" },
          },
          required: ["gameId", "row", "col", "playerName"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "skip_turn",
        description: "Skip your turn and let the AI make a move.",
        parameters: {
          type: "object",
          properties: {
            gameId: { type: "string" },
          },
          required: ["gameId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_players",
        description: "Search for players by team, country, position, or league.",
        parameters: {
          type: "object",
          properties: {
            team: { type: "string" },
            country: { type: "string" },
            position: { type: "string" },
            league: { type: "string" },
          },
          required: [],
        },
      },
    },
  ];
  
  res.json({
    serverUrl, // Tell ChatGPT where to call tools (MCP endpoint)
    tools,
    widgets: [
      {
        id: "game-widget",
        name: "Tic Tac Soccer Game",
        description: "Play tic-tac-toe with soccer players",
        url: `ui://widget/game-widget.html`,
      },
    ],
  });
});

// ChatGPT tool execution endpoint (handles format: /{appName}/link_{id}/{toolName})
// This is the format ChatGPT uses when calling tools directly
app.post("/:appName/link_:linkId/:toolName", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  
  const { toolName } = req.params;
  const args = req.body || {};
  
  try {
    // Create MCP request
    const mcpRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: toolName,
        arguments: args,
      },
    };
    
    // Create a proper request object for the MCP handler
    const mockReq = {
      body: mcpRequest,
      method: "POST",
      headers: { 
        accept: "application/json",
        "content-type": "application/json",
      },
    } as express.Request;
    
    // Create a response object that captures the result
    let responseSent = false;
    const mockRes = {
      setHeader: (name: string, value: string) => {
        res.setHeader(name, value);
      },
      status: (code: number) => {
        if (!responseSent) {
          res.status(code);
        }
        return mockRes;
      },
      json: (data: any) => {
        if (!responseSent) {
          responseSent = true;
          // MCP response format: { jsonrpc: "2.0", result: {...}, id: ... }
          // Extract result - this is our tool response with content and structuredContent
          if (data.result) {
            const result = data.result;
            // The result should already have content: [] and structuredContent: { game }
            // Return it directly as ChatGPT expects this format
            res.json(result);
          } else if (data.error) {
            // Handle errors - still return empty content to keep widget visible
            res.status(500).json({
              content: [],
              structuredContent: { error: data.error.message || "Tool execution failed" },
            });
          } else {
            res.json(data);
          }
        }
      },
      send: (data: any) => {
        if (!responseSent) {
          responseSent = true;
          // Try to parse as JSON if it's a string
          try {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            if (parsed.result) {
              res.json(parsed.result);
            } else {
              res.send(data);
            }
          } catch {
            res.send(data);
          }
        }
      },
      on: () => {},
      headersSent: false,
    } as any;
    
    // Use the existing MCP handler
    await handleMcpRequest(mockReq, mockRes);
    
    // If no response was sent, send a default response to keep widget visible
    if (!responseSent) {
      res.status(200).json({ 
        content: [],
        structuredContent: { error: "No response from tool" }
      });
    }
  } catch (error: any) {
    console.error(`Error executing tool ${toolName}:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        content: [],
        structuredContent: { 
          error: "Tool execution failed",
          message: error.message 
        },
      });
    }
  }
});

// Handle CORS preflight for tool execution endpoint
app.options("/:appName/link_:linkId/:toolName", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  res.sendStatus(204);
});

app.listen(port, () => {
  console.log(
    `\n🚀 Tic Tac Soccer MCP server listening on http://localhost:${port}${MCP_PATH}`
  );
  console.log(`\n📋 Ready for ChatGPT connection!`);
  console.log(`   Use: http://localhost:${port}${MCP_PATH}`);
  console.log(`\n🔗 Available endpoints:`);
  console.log(`   - POST /api/mcp/adapter-http/:appName (MCP adapter)`);
  console.log(`   - POST /:appName/link_:linkId/:toolName (Direct tool calls)`);
  console.log(`   - GET /.well-known/openai-actions (Manifest)`);
  console.log(`   - POST ${MCP_PATH} (MCP protocol)\n`);
});

