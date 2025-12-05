import { Agent } from 'agents';
import type { Env, AgentState, Message } from './types';
import { withTimeout } from './utils';

// Uncomment this import and set OPENAI_API_KEY in your environment
// import { OpenAI } from 'openai';

/**
 * CloudflareDocsAgent - A Discord Bot example for answering Cloudflare questions
 *
 * This agent:
 * - Uses the Agents SDK for state and lifecycle management
 * - Integration with Cloudflare's doc site MCP using custom HTTP-based client
 * - Using Workers AI for inference (with OpenAI example included)
 */
export class CloudflareDocsAgent extends Agent<Env, AgentState> {

  // Define initial state structure - SDK will automatically persist this
  initialState: AgentState = {
    conversationHistory: [],
    userId: '',
    channelId: '',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };

  async onStart(): Promise<void> {
    // Note: Cannot initialize MCP here because addMcpServer() requires a request context
    // MCP initialization happens on-demand in searchDocumentation()
    console.log('[onStart] Agent started. MCP will be initialized on first request.');
  }

  private async initializeMCP(): Promise<string | null> {
    try {
      console.log('[initializeMCP] Connecting to MCP server...');
      console.log('[initializeMCP] MCP_SERVER_URL:', this.env.MCP_SERVER_URL);

      const { id, authUrl } = await this.addMcpServer(
        'CloudflareDocs',
        this.env.MCP_SERVER_URL
      );

      console.log(`[initializeMCP] MCP server added with ID: ${id}`);
      if (authUrl) {
        console.log(`[initializeMCP] Auth URL: ${authUrl}`);
      }

      // Wait for the server to connect
      console.log('[initializeMCP] Waiting for server to be ready...');
      const maxRetries = 10;
      const retryDelay = 500; // ms

      for (let i = 0; i < maxRetries; i++) {
        const state = await this.getMcpServers();
        const server = state.servers[id];

        console.log(`[initializeMCP] Attempt ${i + 1}/${maxRetries} - Server state: ${server?.state || 'unknown'}`);

        if (server?.state === 'ready') {
          console.log(`[initializeMCP] MCP server ready after ${(i + 1) * retryDelay}ms`);
          return id;
        }

        if (server?.state === 'failed') {
          console.error(`[initializeMCP] MCP server connection failed`);
          return null;
        }

        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }

      console.error('[initializeMCP] Timeout waiting for MCP server to be ready');
      return id; // Return ID anyway, might work later

    } catch (error) {
      console.error('[initializeMCP] Failed to connect to MCP server:', error);
      return null;
    }
  }

  // Note: NOT overriding fetch() - this was causing the setName bug!
  // The SDK's fetch() method handles request context properly
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ask' && request.method === 'POST') {
      return await this.handleAskQuestion(request);
    }

    if (url.pathname === '/history' && request.method === 'GET') {
      // state management
      return Response.json({
        conversationHistory: this.state.conversationHistory || [],
        lastActivity: this.state.lastActivity || '',
      });
    }

    if (url.pathname === '/reset' && request.method === 'POST') {
      // automatically persists and notifies clients
      this.setState({
        ...this.state,
        conversationHistory: [],
        lastActivity: new Date().toISOString(),
      });
      return Response.json({ success: true });
    }

    return new Response('Not Found', { status: 404 });
  }

  // handle /ask command
  private async handleAskQuestion(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { question?: string; userId?: string; channelId?: string };
      const { question, userId, channelId } = body;

      if (!question || typeof question !== 'string') {
        return Response.json({ error: 'Question is required' }, { status: 400 });
      }
      if (userId && this.state.userId !== userId) {
        this.setState({ ...this.state, userId });
      }
      if (channelId && this.state.channelId !== channelId) {
        this.setState({ ...this.state, channelId });
      }

      // Add user message to history
      const userMessage: Message = {
        role: 'user',
        content: question,
        timestamp: new Date().toISOString(),
      };

      const updatedHistory = [...this.state.conversationHistory, userMessage];
      this.setState({
        ...this.state,
        conversationHistory: updatedHistory,
      });

      const answer = await this.generateAnswer(question);

      const assistantMessage: Message = {
        role: 'assistant',
        content: answer,
        timestamp: new Date().toISOString(),
      };

      this.setState({
        ...this.state,
        conversationHistory: [...updatedHistory, assistantMessage],
        lastActivity: new Date().toISOString(),
      });

      return Response.json({
        answer,
        timestamp: assistantMessage.timestamp,
      });

    } catch (error) {
      console.error('[handleAskQuestion] Error:', error);
      return Response.json(
        { error: 'Failed to process question' },
        { status: 500 }
      );
    }
  }

  // generate answer using documentation search and AI
  private async generateAnswer(question: string): Promise<string> {
    try {
      // Search the documentation for relevant information
      const docResults = await this.searchDocumentation(question);

      // Check if we got meaningful results
      const hasError = docResults.includes('Error searching documentation');
      const isEmpty = !docResults || docResults.trim().length < 50;

      if (hasError || isEmpty) {
        throw new Error('Unable to find relevant documentation for this question');
      }

      // Replace <PLACEHOLDER> with {{PLACEHOLDER}} to prevent AI from corrupting them <- this was causing issues with some LLMs
      const protectedDocs = docResults.replace(/<([a-zA-Z][a-zA-Z0-9_-]*)>/g, '{{$1}}');
      const hasPlaceholders = protectedDocs !== docResults;

      const conversationContext = this.buildConversationContext();

      const systemPrompt = `You are a Cloudflare documentation assistant. Answer questions using ONLY the provided documentation.

CRITICAL RULES:
1. ONLY use information from the Documentation Search Results below
2. Keep response under 1500 characters - be CONCISE
3. ONLY respond with the steps. DO NOT response or add the "complete example"
4. DO NOT add information from general knowledge
5. If docs don't answer the question, say: "I couldn't find information about that in the Cloudflare documentation."
6. Preserve code placeholders EXACTLY as shown - use {{PLACEHOLDER}} format
7. INCLUDE the link to the reference document you used at the end of your answer

Documentation Search Results:
${protectedDocs}`;

      const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationContext,
        { role: 'user', content: question }
      ];

      // OPTION 1: Workers AI (default self contained option)
      // Using Qwen 2.5 Coder which has been the best for me so far
      const response = await withTimeout(
        this.env.AI.run('@cf/qwen/qwen2.5-coder-32b-instruct' as any, {
          messages,
          max_tokens: 600,
          temperature: 0.2,  // Low temperature for accuracy
        }),
        20000,
        'Workers AI request timed out'
      ) as { response: string };

      let answer = response.response;

      /* OPTION 2: OpenAI (alternative implementation)
       * To use OpenAI instead of Workers AI:
       * 1. Uncomment the import at the top: import { OpenAI } from 'openai';
       * 2. Add OPENAI_API_KEY to your environment (wrangler secret put OPENAI_API_KEY)
       * 3. Add to Env interface in types.ts: OPENAI_API_KEY: string;
       * 4. Install OpenAI package: npm install openai
       * 5. Replace the Workers AI code above with this:

      const openai = new OpenAI({
        apiKey: this.env.OPENAI_API_KEY,
      });

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // or 'gpt-4', 'o3-mini', etc.
        messages: messages as any,
        max_tokens: 600,
        temperature: 0.2,
      });

      let answer = completion.choices[0]?.message?.content || '';
      */

      if (!answer || answer.trim().length < 10) {
        throw new Error('AI returned empty or invalid response');
      }

      // Restore angle bracket placeholders - had issues without this rending the first character after the angle bracket
      if (hasPlaceholders) {
        answer = answer.replace(/\{\{([a-zA-Z][a-zA-Z0-9_-]*)\}\}/g, '<$1>');
      }

      return answer;

    } catch (error) {
      console.error('[generateAnswer] Error:', error);

      if (error instanceof Error) {
        if (error.message.includes('Unable to find relevant documentation')) {
          return '❌ I couldn\'t find information about that in the Cloudflare documentation.\n\nPlease check https://developers.cloudflare.com or try rephrasing your question.';
        }
        if (error.message.includes('timed out')) {
          throw error;
        }
      }

      return '❌ I encountered an error. Please try again or check https://developers.cloudflare.com';
    }
  }

  // documentation search using built-in MCP client
  private async searchDocumentation(query: string): Promise<string> {
    try {
      // Get current MCP server state (await the promise)
      const mcpState = await this.getMcpServers();
      const servers = mcpState.servers;
      let serverId = Object.keys(servers)[0];

      console.log('[searchDocumentation] MCP State:', JSON.stringify({
        serverIds: Object.keys(servers),
        serverStates: Object.fromEntries(
          Object.entries(servers).map(([id, server]: [string, any]) => [id, server.state])
        )
      }));

      // If no server found or server is stuck in a non-ready state, (re)initialize MCP
      const serverState = serverId ? servers[serverId]?.state : null;
      const isServerStuck = serverState && serverState !== 'ready' && serverState !== 'connecting' && serverState !== 'discovering';

      if (!serverId || isServerStuck) {
        if (serverId && isServerStuck) {
          console.log(`[searchDocumentation] Server ${serverId} stuck in ${serverState} state. Removing and reconnecting...`);
          try {
            await this.removeMcpServer(serverId);
            console.log(`[searchDocumentation] Removed stuck server ${serverId}`);
          } catch (error) {
            console.error('[searchDocumentation] Error removing stuck server:', error);
          }
        }

        console.log('[searchDocumentation] Initializing MCP...');
        const newServerId = await this.initializeMCP();
        if (!newServerId) {
          return 'Error searching documentation: Failed to initialize MCP server';
        }
        serverId = newServerId;

        // Refresh servers list after initialization
        const refreshedState = await this.getMcpServers();
        const refreshedServer = refreshedState.servers[serverId];
        if (!refreshedServer || refreshedServer.state !== 'ready') {
          return `Error searching documentation: Server initialized but not ready (state: ${refreshedServer?.state || 'unknown'})`;
        }
      }

      // Check if server is ready
      const server = servers[serverId];
      if (server && server.state !== 'ready') {
        console.log(`[searchDocumentation] Server ${serverId} is in state: ${server.state}. Waiting for ready state...`);

        // Wait up to 5 seconds for the server to be ready
        const maxWait = 10; // 10 attempts
        for (let i = 0; i < maxWait; i++) {
          await new Promise(resolve => setTimeout(resolve, 500));
          const updatedState = await this.getMcpServers();
          const updatedServer = updatedState.servers[serverId];

          console.log(`[searchDocumentation] Wait attempt ${i + 1}/${maxWait} - Server state: ${updatedServer?.state || 'unknown'}`);

          if (updatedServer?.state === 'ready') {
            console.log('[searchDocumentation] Server is now ready');
            break;
          }

          if (updatedServer?.state === 'failed') {
            return `Error searching documentation: Server connection failed. Please check MCP_SERVER_URL: ${this.env.MCP_SERVER_URL}`;
          }
        }

        // Final check
        const finalState = await this.getMcpServers();
        const finalServer = finalState.servers[serverId];
        if (!finalServer || finalServer.state !== 'ready') {
          return `Error searching documentation: Server not ready after 5 seconds (state: ${finalServer?.state || 'unknown'}). MCP_SERVER_URL: ${this.env.MCP_SERVER_URL}`;
        }
      }

      // Get the MCP client - the beta version should have this working properly now
      // Note: Accessing internal API until public tool-calling API is documented
      // @ts-ignore - accessing internal property
      const connection = this.mcp?.mcpConnections?.[serverId];

      if (!connection || !connection.client) {
        return 'Error searching documentation: MCP client not available';
      }

      // Call the MCP tool using the client
      const result = await connection.client.callTool({
        name: 'search_cloudflare_documentation',
        arguments: { query }
      });

      // Parse the result content
      if (!result || !result.content || !Array.isArray(result.content)) {
        throw new Error('Invalid tool response format');
      }

      const textContent = result.content
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text)
        .join('\n\n');

      return textContent || 'No documentation found';

    } catch (error) {
      console.error('[searchDocumentation] Error:', error);
      return `Error searching documentation: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  // build conversation context and history
  private buildConversationContext(): Array<{ role: string; content: string }> {
    const maxMessages = 10; // Last 5 exchanges (user + assistant)
    const recentHistory = this.state.conversationHistory.slice(-maxMessages);

    return recentHistory.map((msg: Message) => ({
      role: msg.role,
      content: msg.content,
    }));
  }
}

// Export the agent as default for Cloudflare Workers
export default CloudflareDocsAgent;
