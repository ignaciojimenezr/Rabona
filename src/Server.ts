import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import type { ServerConfig } from './types.js';
import type { Game } from './GameEngine.js';
import { WidgetRegistry } from './WidgetRegistry.js';
import { ToolRegistry } from './ToolRegistry.js';
import { SquadStore } from './SquadStore.js';
import { GameEngine } from './GameEngine.js';

/**
 * OpenAI App Server - Main server class
 * 
 * Note: Using Express for HTTP server. Alternatives:
 * - Node's built-in http module (zero dependencies, more verbose)
 * - Fastify (faster, similar API to Express)
 * - Hono (lightweight, edge-ready)
 * 
 * Express was chosen for familiarity and middleware ecosystem,
 * but can be swapped if you prefer a different approach.
 */
export class OpenAIServer {
  private app: Express;
  private widgetRegistry: WidgetRegistry;
  private toolRegistry: ToolRegistry;
  private squadStore: SquadStore;
  private gameEngine: GameEngine;
  private activeGames: Map<string, Game> = new Map();
  private config: ServerConfig;
  private server: any;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.widgetRegistry = new WidgetRegistry();
    this.toolRegistry = new ToolRegistry();
    this.squadStore = new SquadStore(config.squadDataPath);
    this.gameEngine = new GameEngine(this.squadStore);

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    
    // Serve static files from public directory
    this.app.use(express.static('public'));
    
    if (this.config.cors !== false) {
      this.app.use(cors());
    }
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Widget endpoints
    this.app.get('/widgets', (_req: Request, res: Response) => {
      res.json(this.widgetRegistry.getManifest());
    });

    this.app.get('/widgets/:id', (req: Request, res: Response) => {
      const widget = this.widgetRegistry.get(req.params.id);
      if (!widget) {
        return res.status(404).json({ error: 'Widget not found' });
      }
      res.json(widget);
    });

    // Tool endpoints
    this.app.get('/tools', (_req: Request, res: Response) => {
      res.json({
        tools: this.toolRegistry.getOpenAIActions(),
      });
    });

    this.app.post('/tools/:id/execute', async (req: Request, res: Response) => {
      try {
        const { id } = req.params;
        const params = req.body;

        if (!this.toolRegistry.has(id)) {
          return res.status(404).json({ error: 'Tool not found' });
        }

        const result = await this.toolRegistry.execute(id, params);
        res.json({ result });
      } catch (error: any) {
        console.error('Tool execution error:', error);
        res.status(500).json({ 
          error: 'Tool execution failed', 
          message: error.message 
        });
      }
    });

    // OpenAI App manifest endpoint (GET)
    this.app.get('/.well-known/openai-actions', (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'application/json');
      res.json({
        widgets: this.widgetRegistry.getManifest().widgets,
        tools: this.toolRegistry.getOpenAIActions(),
      });
    });

    // Player data endpoint
    this.app.get('/players', (req: Request, res: Response) => {
      const filters = {
        Name: (req.query.name as string) || undefined,
        Team: (req.query.team as string) || undefined,
        Country: (req.query.country as string) || undefined,
        Position: (req.query.position as string) || undefined,
        League: (req.query.league as string) || undefined,
      };

      const players = this.squadStore.search(filters);
      res.json({ count: players.length, players });
    });

    this.app.post('/players/reload', (_req: Request, res: Response) => {
      this.squadStore.load();
      res.json({ status: 'reloaded', count: this.squadStore.getAll().length });
    });

    // Game endpoints
    this.app.post('/games/new', (req: Request, res: Response) => {
      try {
        const game = this.gameEngine.generateGame();
        this.activeGames.set(game.id, game);
        res.json(game);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/games/:id', (req: Request, res: Response) => {
      const game = this.activeGames.get(req.params.id);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }
      res.json(game);
    });

    this.app.post('/games/:id/move', (req: Request, res: Response) => {
      const game = this.activeGames.get(req.params.id);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }
      const { row, col } = req.body;
      if (typeof row !== 'number' || typeof col !== 'number') {
        return res.status(400).json({ error: 'Row and col must be numbers' });
      }
      const result = this.gameEngine.makeUserMove(game, row, col);
      if (result.success) {
        this.activeGames.set(game.id, result.game);
        res.json(result.game);
      } else {
        res.status(400).json({ error: result.message || 'Invalid move' });
      }
    });

    this.app.post('/games/:id/ai-move', (req: Request, res: Response) => {
      const game = this.activeGames.get(req.params.id);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }
      const result = this.gameEngine.makeAIMove(game);
      if (result.success) {
        this.activeGames.set(game.id, result.game);
        res.json(result.game);
      } else {
        res.status(400).json({ error: result.message || 'AI move failed' });
      }
    });

    this.app.get('/categories/:type/options', (req: Request, res: Response) => {
      const type = req.params.type as any;
      const options = this.gameEngine.getCategoryOptions(type);
      res.json({ category: type, options });
    });
  }

  /**
   * Get widget registry
   */
  getWidgetRegistry(): WidgetRegistry {
    return this.widgetRegistry;
  }

  /**
   * Get tool registry
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }

  /**
   * Get game engine
   */
  getGameEngine(): GameEngine {
    return this.gameEngine;
  }

  /**
   * Get active games map
   */
  getActiveGames(): Map<string, Game> {
    return this.activeGames;
  }

  /**
   * Get squad store
   */
  getSquadStore(): SquadStore {
    return this.squadStore;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const host = this.config.host || 'localhost';
      this.server = this.app.listen(this.config.port, host, () => {
        console.log(`\n🚀 OpenAI App Server running at http://${host}:${this.config.port}`);
        console.log(`\n📋 Available endpoints:`);
        console.log(`   GET  /health - Health check`);
        console.log(`   GET  /widgets - List all widgets`);
        console.log(`   GET  /widgets/:id - Get widget by ID`);
        console.log(`   GET  /tools - List all tools (OpenAI Actions format)`);
        console.log(`   POST /tools/:id/execute - Execute a tool`);
        console.log(`   GET  /.well-known/openai-actions - OpenAI App manifest`);
        console.log(`   GET  /players - List players (filterable)`);
        console.log(`   POST /players/reload - Reload player data from CSV`);
        console.log(`   POST /games/new - Create a new 3x3 tic-tac-toe game`);
        console.log(`   GET  /games/:id - Get game state`);
        console.log(`   POST /games/:id/move - User makes a move (places O)`);
        console.log(`   POST /games/:id/ai-move - AI makes a move (places X)`);
        console.log(`   GET  /categories/:type/options - Get category options\n`);
        resolve();
      });

      this.server.on('error', (error: Error) => {
        reject(error);
      });
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          console.log('Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

