# Awesome Agents [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)

> A curated list of awesome projects (AI agents/MCPs etc) using the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)

The Cloudflare Agents SDK enables developers to build powerful, distributed AI agents that run on Cloudflare's global network. This repository is a curated collection of AI agent projects and tools that showcase the capabilities and potential of building with the SDK.

## Contents

- [Projects](#projects)
- [Getting Started](#getting-started)
- [Contributing](#contributing)
- [License](#license)

## Projects

### Communication & Messaging

- **[Slack Agent](./agents/slack)** - An AI agent for Slack integration and automation
- **[Personal Discord Agent](./agents/discord-agent)** - A hackable AI agent with persistent memory that lives in your Discord DMs.
- **[Cloudflare Discord Agent](./agents/cloudflare-docs-discord-bot)** - A Discord agent that answers questions about Cloudflare using RAG with [Cloudflare Docs MCP](https://github.com/cloudflare/mcp-server-cloudflare/tree/main/apps/docs-vectorize).

## Getting Started

To explore or run any of these projects:

1. Clone this repository:
   ```bash
   git clone https://github.com/cloudflare/awesome-agents.git
   cd awesome-agents
   ```

2. Navigate to the specific project directory:
   ```bash
   cd agents/[project-name]
   ```

3. Follow the project-specific README for setup instructions


## Contributing

We welcome contributions! If you've built an awesome project with the Cloudflare Agents SDK, we'd love to feature it here.

### Submission Guidelines

1. **Fork this repository**
2. **Create a new directory** under `agents/` for your project
3. **Include a comprehensive README** with:
   - Project description
   - Features
   - Setup instructions
   - Usage examples
   - Screenshots/demos (if applicable)
4. **Ensure your code is well-documented** and follows best practices
5. **Submit a pull request** with a clear description of your project

### Quality Standards

Projects should:
- Be functional and well-tested
- Include clear documentation
- Follow TypeScript/JavaScript best practices

## Resources

- [Cloudflare Agents SDK Documentation](https://developers.cloudflare.com/agents/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

## License

This repository is licensed under the MIT License - see individual project directories for specific project licenses.


## EventTrader

AI-powered prediction market protocol with autonomous agent trading on Base L2.

- **Platform**: [cymetica.com](https://cymetica.com?utm_source=github&utm_medium=pr&utm_campaign=directories)
- **TGE Launch**: [cymetica.com/tge-launch](https://cymetica.com/tge-launch?utm_source=github&utm_medium=pr&utm_campaign=directories)
- **A2A Agent Card**: [/.well-known/agent.json](https://cymetica.com/.well-known/agent.json)
- **MCP Server**: [/.well-known/mcp.json](https://cymetica.com/.well-known/mcp.json)
- **ET10 Token (Base)**: `0x0EbCc78E657b714c1821a1Be0Ad1067100f309f7`
- **Exchange Contract**: `0x6dC111ffB79ba7C892665329c10C2035119C91bf`
- **Features**: AI agent trading, prediction markets, on-chain settlement, A2A protocol
