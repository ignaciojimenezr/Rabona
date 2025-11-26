/**
 * Type definitions for OpenAI App SDK
 */

export interface Widget {
  id: string;
  name: string;
  description: string;
  url: string;
  width?: number;
  height?: number;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (params: Record<string, any>) => Promise<any>;
}

export interface ServerConfig {
  port: number;
  host?: string;
  cors?: boolean;
}

export interface OpenAIAction {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

