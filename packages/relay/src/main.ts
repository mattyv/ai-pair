// pair-mcp: the MCP server the agent harness launches. It forwards tool calls to the editor.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { discoveryDir } from '@ai-pair/protocol';
import guideMarkdown from '../../../AGENT_GUIDE.md';
import { EditorLink } from './link';
import { agentGuide, serve } from './server';
import { forwardCodexWorkerTranscript, WORKER_TRANSCRIPT_FAILURE } from './worker_output';

declare const AI_PAIR_VERSION: string;

const cwd = process.cwd();
const relayHash = createHash('sha256').update(readFileSync(__filename)).digest('hex');
const dir = discoveryDir();
const runtime = { version: AI_PAIR_VERSION, relayHash };
const [, , command, provider, ...extra] = process.argv;

if (command === 'worker-transcript') {
  if (provider === 'codex' && extra.length === 0) {
    void forwardCodexWorkerTranscript(process.stdin, new EditorLink(cwd, dir, runtime)).then((completed) => {
      if (completed) return;
      process.stderr.write(`${WORKER_TRANSCRIPT_FAILURE}\n`);
      process.exitCode = 1;
    });
  } else {
    process.stderr.write('Usage: pair-mcp worker-transcript codex\n');
    process.exitCode = 1;
  }
} else {
  // A failure to serve is unhandled on purpose: Node prints it and exits with 1, as a catch here would.
  void serve({ transport: new StdioServerTransport(), guide: agentGuide(guideMarkdown), cwd, dir, stdin: process.stdin, runtime });
}
