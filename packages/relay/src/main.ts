// pair-mcp: the MCP server the agent harness launches. It forwards tool calls to the editor.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { discoveryDir } from '@ai-pair/protocol';
import guideMarkdown from '../../../AGENT_GUIDE.md';
import { agentGuide, serve } from './server';

declare const AI_PAIR_VERSION: string;

const cwd = process.cwd();
const relayHash = createHash('sha256').update(readFileSync(__filename)).digest('hex');
// A failure to serve is unhandled on purpose: Node prints it and exits with 1, as a catch here would.
void serve({
  transport: new StdioServerTransport(),
  guide: agentGuide(guideMarkdown),
  cwd,
  dir: discoveryDir(),
  stdin: process.stdin,
  runtime: { version: AI_PAIR_VERSION, relayHash },
});
