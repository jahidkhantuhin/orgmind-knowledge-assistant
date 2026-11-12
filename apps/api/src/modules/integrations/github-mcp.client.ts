import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { env } from '../../config/env.js';

export const GITHUB_READONLY_MCP_ENDPOINT = 'https://api.githubcopilot.com/mcp/readonly';
const MCP_TIMEOUT_MS = 30_000;

type GithubSource = { owner: string; repository: string; branch: string; path: string };
type ToolContent = {
  type: string;
  text?: string;
  resource?: { text?: string; blob?: string; mimeType?: string; uri?: string };
};
type ToolResult = {
  isError?: boolean;
  content?: ToolContent[];
  structuredContent?: unknown;
};

function fileToolArguments(
  fileTool: { inputSchema: unknown },
  source: GithubSource,
): Record<string, string> {
  const input = fileTool.inputSchema as { properties?: Record<string, unknown> } | undefined;
  const properties = input?.properties ?? {};
  const args: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    owner: source.owner,
    repo: source.repository,
    path: source.path,
    ref: source.branch,
  })) {
    if (key in properties) args[key] = value;
  }
  if (!('owner' in args) || !('repo' in args) || !('path' in args) || !('ref' in args)) {
    throw new Error('GitHub MCP file tool has an unexpected input schema.');
  }
  return args;
}

async function withGithubClient<T>(
  accessToken: string,
  action: (_client: Client) => Promise<T>,
  endpoint = GITHUB_READONLY_MCP_ENDPOINT,
): Promise<T> {
  const client = new Client({ name: 'orgmind-github-connector', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    authProvider: { token: async () => accessToken },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        await client.connect(transport);
        return action(client);
      })(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error('GitHub MCP request timed out.')),
          MCP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    await client.close().catch(() => undefined);
  }
}

function isGithubStatusText(text: string): boolean {
  return /^successfully downloaded text file(?:\s*\(SHA:\s*[a-f0-9]+\))?\s*$/i.test(text.trim());
}

function resultText(result: ToolResult): string {
  if (result.isError) {
    const detail = result.content
      ?.map((item) => item.text ?? '')
      .filter(Boolean)
      .join('\n');
    throw new Error(detail?.slice(0, 500) || 'GitHub MCP could not read this file.');
  }
  const embeddedText = result.content
    ?.filter((item) => item.type === 'resource')
    .map((item) => {
      if (item.type !== 'resource' || !item.resource) return '';
      if (typeof item.resource.text === 'string') return item.resource.text;
      if (typeof item.resource.blob === 'string') {
        const mimeType = item.resource.mimeType?.toLowerCase() ?? '';
        if (!mimeType.startsWith('text/') && !mimeType.includes('json')) {
          throw new Error('GitHub MCP returned a non-text file resource.');
        }
        return Buffer.from(item.resource.blob, 'base64').toString('utf8');
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
  if (embeddedText) return embeddedText;

  const structured = result.structuredContent;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    const record = structured as Record<string, unknown>;
    for (const key of ['content', 'text', 'fileContent']) {
      if (typeof record[key] === 'string' && !isGithubStatusText(record[key])) return record[key];
      if (Array.isArray(record[key])) {
        const structuredText = resultText({ content: record[key] as ToolContent[] });
        if (structuredText) return structuredText;
      }
    }
  }
  const text = result.content
    ?.map((item) => (item.type === 'text' ? (item.text ?? '') : ''))
    .filter((item) => !isGithubStatusText(item))
    .join('\n');
  if (!text?.trim()) throw new Error('GitHub MCP returned no text for this file.');
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      for (const key of ['content', 'text', 'fileContent']) {
        if (typeof record[key] === 'string') return record[key];
      }
    }
  } catch {
    // GitHub MCP commonly returns the file body directly as text.
  }
  return text;
}

function checkedFileText(result: ToolResult): string {
  const text = resultText(result);
  if (Buffer.byteLength(text, 'utf8') > env.MAX_DOCUMENT_TEXT_BYTES) {
    throw new Error('The connected text file exceeds the configured document text limit.');
  }
  return text;
}

export async function verifyGithubMcpAccess(
  accessToken: string,
  source: GithubSource,
): Promise<void> {
  await withGithubClient(accessToken, async (client) => {
    const { tools } = await client.listTools();
    const fileTool = tools.find((tool) => tool.name === 'get_file_contents');
    if (!fileTool) {
      throw new Error('The GitHub MCP server does not expose the read-only file tool.');
    }
    const result = (await client.callTool({
      name: fileTool.name,
      arguments: fileToolArguments(fileTool, source),
    })) as ToolResult;
    checkedFileText(result);
  });
}

export async function readGithubFile(accessToken: string, source: GithubSource): Promise<string> {
  return withGithubClient(accessToken, async (client) => {
    const { tools } = await client.listTools();
    const fileTool = tools.find((tool) => tool.name === 'get_file_contents');
    if (!fileTool) throw new Error('The GitHub MCP server does not expose get_file_contents.');
    const result = (await client.callTool({
      name: fileTool.name,
      arguments: fileToolArguments(fileTool, source),
    })) as ToolResult;
    return checkedFileText(result);
  });
}
