/**
 * OpenAI App SDK - Main entry point
 * 
 * Flow:
 * 1. Create server
 * 2. Register widget
 * 3. Register tools
 * 4. Connect to HTTP (local)
 * 5. (Later) Make public with ngrok or alpic
 */

export { OpenAIServer } from './Server.js';
export { WidgetRegistry } from './WidgetRegistry.js';
export { ToolRegistry } from './ToolRegistry.js';
export type { Widget, Tool, ServerConfig, OpenAIAction } from './types.js';

