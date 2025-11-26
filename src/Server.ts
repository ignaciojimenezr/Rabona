import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import type { ServerConfig } from './types.js';
import { WidgetRegistry } from './WidgetRegistry.js';
import { ToolRegistry } from './ToolRegistry.js';

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
  private config: ServerConfig;
  private server: any;

  constructor(config: ServerConfig) {
    this.config = config;
    this.app = express();
    this.widgetRegistry = new WidgetRegistry();
    this.toolRegistry = new ToolRegistry();

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    
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

    // OpenAI Actions endpoint (for OpenAI App integration)
    this.app.get('/.well-known/openai-actions', (_req: Request, res: Response) => {
      res.json({
        widgets: this.widgetRegistry.getManifest().widgets,
        tools: this.toolRegistry.getOpenAIActions(),
      });
    });

    // MCP Server endpoint
    this.app.post('/mcp', async (req: Request, res: Response) => {
      try {
        const { method, params } = req.body;

        switch (method) {
          case 'tools/list':
            res.json({
              tools: this.toolRegistry.getOpenAIActions(),
            });
            break;

          case 'tools/call':
            const { name, arguments: toolArgs } = params;
            if (!this.toolRegistry.has(name)) {
              return res.status(404).json({ 
                error: { 
                  code: -32601, 
                  message: `Tool "${name}" not found` 
                } 
              });
            }
            const result = await this.toolRegistry.execute(name, toolArgs || {});
            res.json({ content: [{ type: 'text', text: JSON.stringify(result) }] });
            break;

          case 'resources/list':
            // Return widgets as resources
            res.json({
              resources: this.widgetRegistry.getAll().map(widget => ({
                uri: widget.url,
                name: widget.name,
                description: widget.description,
                mimeType: 'text/html',
              })),
            });
            break;

          case 'resources/read':
            const { uri } = params;
            const widget = this.widgetRegistry.getAll().find(w => w.url === uri);
            if (!widget) {
              return res.status(404).json({ 
                error: { 
                  code: -32601, 
                  message: `Resource "${uri}" not found` 
                } 
              });
            }
            res.json({ 
              contents: [{ 
                uri: widget.url, 
                mimeType: 'text/html', 
                text: JSON.stringify(widget) 
              }] 
            });
            break;

          default:
            res.status(400).json({ 
              error: { 
                code: -32601, 
                message: `Method "${method}" not supported` 
              } 
            });
        }
      } catch (error: any) {
        console.error('MCP request error:', error);
        res.status(500).json({ 
          error: { 
            code: -32603, 
            message: 'Internal error', 
            data: error.message 
          } 
        });
      }
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
        console.log(`   POST /mcp - MCP Server endpoint\n`);
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

