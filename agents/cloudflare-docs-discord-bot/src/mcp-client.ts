import type { MCPTool, MCPResponse } from './types';
import { withTimeout } from './utils';

export class CloudflareMCPClient {
  private tools: MCPTool[] = [];
  private serverUrl: string;

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }


  private parseSSE(text: string): any {
    const lines = text.trim().split('\n');
    let data = '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        data += line.substring(6);
      }
    }

    const parsed = JSON.parse(data);

    // Decode HTML entities if present
    if (parsed.result?.content) {
      parsed.result.content = parsed.result.content.map((item: any) => {
        if (item.type === 'text' && item.text) {
          item.text = item.text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&apos;/g, "'");
        }
        return item;
      });
    }

    return parsed;
  }

// mcp connection
  async initialize(): Promise<void> {
    try {
      const response = await fetch(`${this.serverUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {}
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch tools: ${response.statusText}`);
      }

      // Parse response (may be JSON or SSE)
      const contentType = response.headers.get('content-type') || '';
      let data: any;

      if (contentType.includes('text/event-stream')) {
        const text = await response.text();
        data = this.parseSSE(text);
      } else {
        data = await response.json();
      }

      this.tools = data.result?.tools || [];
    } catch (error) {
      console.error('Failed to initialize MCP client:', error);
      this.tools = [{
        name: 'search_cloudflare_documentation',
        description: 'Search Cloudflare documentation for relevant information',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query'
            }
          },
          required: ['query']
        }
      }];
    }
  }

  getTools(): MCPTool[] {
    return this.tools;
  }

// call mcp tool
  async callTool(toolName: string, args: Record<string, unknown>): Promise<MCPResponse> {
    try {
      const response = await withTimeout(
        fetch(`${this.serverUrl}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'tools/call',
            params: {
              name: toolName,
              arguments: args
            }
          })
        }),
        10000,
        'MCP server request timed out'
      );

      if (!response.ok) {
        throw new Error(`Tool call failed: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('text/event-stream')
        ? this.parseSSE(await response.text())
        : await response.json();

      if (data.error) {
        throw new Error(`Tool error: ${data.error.message}`);
      }

      return data.result;
    } catch (error) {
      console.error('[MCPClient] Error:', error);
      return {
        content: [{
          type: 'text',
          text: `Error searching documentation: ${error instanceof Error ? error.message : 'Unknown error'}`
        }]
      };
    }
  }

// search documentation
  async searchDocumentation(query: string): Promise<string> {
    const response = await this.callTool('search_cloudflare_documentation', { query });

    if (!response?.content?.length) {
      throw new Error('No documentation results returned');
    }

    const results = response.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n\n');

    if (!results.trim()) {
      throw new Error('No documentation content found');
    }

    return results;
  }
}
