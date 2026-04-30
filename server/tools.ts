import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { commandDefinitions, executeCommand, getCommandInputShape } from './command-registry.js';
import { toErrorPayload } from './errors.js';
import { packageVersion } from './version.js';

const createTextResult = <T>(payload: T) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  structuredContent: payload as Record<string, unknown>,
});

const createErrorResult = (error: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(toErrorPayload(error), null, 2) }],
  isError: true,
  structuredContent: {
    error: toErrorPayload(error),
  },
});

const createJsonResource = (uri: string, payload: unknown) => ({
  contents: [
    {
      mimeType: 'application/json',
      text: JSON.stringify(payload, null, 2),
      uri,
    },
  ],
});

export const createMcpApp = () => {
  const server = new McpServer({
    name: 'power-automate-local',
    version: packageVersion,
  });

  server.registerResource(
    'power-automate-context',
    'power-automate://context',
    {
      description: 'Current Power Automate context, capabilities, and cached summaries.',
      mimeType: 'application/json',
      title: 'Power Automate Context',
    },
    async () => createJsonResource('power-automate://context', await executeCommand('get_context')),
  );

  server.registerResource(
    'power-automate-last-run',
    'power-automate://last-run',
    {
      description: 'Last cached run summary for the connected flow.',
      mimeType: 'application/json',
      title: 'Power Automate Last Run',
    },
    async () => {
      const payload = (await executeCommand('get_context')) as { lastRun?: unknown };
      return createJsonResource('power-automate://last-run', { lastRun: payload.lastRun || null });
    },
  );

  server.registerResource(
    'power-automate-last-update',
    'power-automate://last-update',
    {
      description: 'Last cached update summary for the connected flow.',
      mimeType: 'application/json',
      title: 'Power Automate Last Update',
    },
    async () => createJsonResource('power-automate://last-update', await executeCommand('get_last_update')),
  );

  for (const command of commandDefinitions) {
    server.registerTool(
      command.name,
      {
        description: command.description,
        inputSchema: getCommandInputShape(command),
      },
      async (input) => {
        try {
          return createTextResult(await executeCommand(command.name, input));
        } catch (error) {
          return createErrorResult(error);
        }
      },
    );
  }

  return server;
};
