import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMcpServer = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  transport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/client', () => ({
  Client: class {
    connect(transport: unknown) {
      return mockMcpServer.connect(transport);
    }
    listTools() {
      return mockMcpServer.listTools();
    }
    callTool(request: unknown) {
      return mockMcpServer.callTool(request);
    }
    close() {
      return mockMcpServer.close();
    }
  },
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: unknown) {
      mockMcpServer.transport({ url: url.toString(), options });
    }
  },
}));

import {
  GITHUB_READONLY_MCP_ENDPOINT,
  readGithubFile,
  verifyGithubMcpAccess,
} from '../src/modules/integrations/github-mcp.client.js';

const fileTool = {
  name: 'get_file_contents',
  inputSchema: {
    properties: { owner: {}, repo: {}, path: {}, ref: {} },
  },
};

describe('GitHub MCP client with a mocked MCP server', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMcpServer.connect.mockResolvedValue(undefined);
    mockMcpServer.close.mockResolvedValue(undefined);
    mockMcpServer.listTools.mockResolvedValue({ tools: [fileTool] });
    mockMcpServer.callTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'successfully downloaded text file (SHA: abc123)' },
        {
          type: 'resource',
          resource: {
            uri: 'repo://octocat/handbook/contents/README.md',
            mimeType: 'text/markdown; charset=utf-8',
            text: '# Team handbook\n\nRead-only policy.',
          },
        },
      ],
    });
  });

  it('checks the read-only GitHub MCP endpoint and available file tool', async () => {
    await verifyGithubMcpAccess('test-token', {
      owner: 'octocat',
      repository: 'handbook',
      branch: 'main',
      path: 'README.md',
    });

    expect(mockMcpServer.transport).toHaveBeenCalledWith({
      url: GITHUB_READONLY_MCP_ENDPOINT,
      options: { authProvider: { token: expect.any(Function) } },
    });
    const transportOptions = mockMcpServer.transport.mock.calls[0]?.[0]?.options;
    await expect(transportOptions.authProvider.token()).resolves.toBe('test-token');
    expect(mockMcpServer.listTools).toHaveBeenCalledOnce();
    expect(mockMcpServer.close).toHaveBeenCalledOnce();
  });

  it('reads the requested repository path through get_file_contents', async () => {
    const content = await readGithubFile('test-token', {
      owner: 'octocat',
      repository: 'handbook',
      branch: 'main',
      path: 'docs/team.md',
    });

    expect(content).toBe('# Team handbook\n\nRead-only policy.');
    expect(mockMcpServer.callTool).toHaveBeenCalledWith({
      name: 'get_file_contents',
      arguments: { owner: 'octocat', repo: 'handbook', path: 'docs/team.md', ref: 'main' },
    });
  });

  it('does not mistake GitHub MCP status text for file content', async () => {
    mockMcpServer.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'successfully downloaded text file (SHA: abc123)' }],
    });

    await expect(
      readGithubFile('test-token', {
        owner: 'octocat',
        repository: 'handbook',
        branch: 'main',
        path: 'README.md',
      }),
    ).rejects.toThrow('GitHub MCP returned no text for this file.');
  });

  it('surfaces MCP tool errors without treating them as file content', async () => {
    mockMcpServer.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'Repository access denied.' }],
    });

    await expect(
      readGithubFile('test-token', {
        owner: 'octocat',
        repository: 'private-handbook',
        branch: 'main',
        path: 'README.md',
      }),
    ).rejects.toThrow('Repository access denied.');
  });

  it('rejects a server that does not expose the safe file-reading tool', async () => {
    mockMcpServer.listTools.mockResolvedValue({ tools: [{ name: 'create_issue' }] });
    await expect(
      verifyGithubMcpAccess('test-token', {
        owner: 'octocat',
        repository: 'handbook',
        branch: 'main',
        path: 'README.md',
      }),
    ).rejects.toThrow('The GitHub MCP server does not expose the read-only file tool.');
  });
});
