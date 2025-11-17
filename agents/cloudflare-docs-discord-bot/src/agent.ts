import { Agent } from 'agents';
import { CloudflareMCPClient } from './mcp-client';
import type { Env, AgentState, Message } from './types';
import { withTimeout } from './utils';

// Uncomment this import and set OPENAI_API_KEY in your environment
// import { OpenAI } from 'openai';

/**
 * CloudflareDocsAgent - A Discord Bot example for answering Cloudflare questions
 *
 * This agent:
 * - Uses the Agents SDK for state and lifecycle management
 * - Integration with Cloudflare's doc site MCP
 * - Using Workers AI for inference (with OpenAI example included)
 */
export class CloudflareDocsAgent extends Agent<Env, AgentState> {
  private mcpClient: CloudflareMCPClient | null = null;
  private initialized = false;

  // Define initial state structure - SDK will automatically persist this
  initialState: AgentState = {
    conversationHistory: [],
    userId: '',
    channelId: '',
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
  };


  async onStart(): Promise<void> {
    // Initialize MCP client
    this.mcpClient = new CloudflareMCPClient(this.env.MCP_SERVER_URL);
    await this.mcpClient.initialize();
    this.initialized = true;
  }

// fetch entry point
  async fetch(request: Request): Promise<Response> {
    // Ensure agent is initialized before handling requests
    if (!this.initialized) {
      await this.onStart();
    }
    return this.onRequest(request);
  }

// handle requests
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

  // documentation search
  private async searchDocumentation(query: string): Promise<string> {
    if (!this.mcpClient) {
      return 'Error searching documentation: MCP client not available';
    }

    try {
      const results = await this.mcpClient.searchDocumentation(query);

      if (!results || results.trim().length === 0) {
        return 'Error searching documentation: No results returned';
      }

      return results;
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
