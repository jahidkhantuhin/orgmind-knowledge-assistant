import type { Collection, Document } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { upsertSearchIndex } from '../src/db/search-indexes.js';

describe('search index upsert', () => {
  it('recreates a vector index when the server treats its update as a text mapping', async () => {
    const existing = {
      name: 'chunks_vector_index',
      type: 'vectorSearch',
      latestDefinition: { fields: [{ type: 'filter', path: 'orgId' }] },
    };
    const listSearchIndexes = vi
      .fn()
      .mockReturnValueOnce({ toArray: vi.fn().mockResolvedValue([existing]) })
      .mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
    const updateSearchIndex = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('"mappings" is required'), { code: 2 }));
    const dropSearchIndex = vi.fn().mockResolvedValue(undefined);
    const createSearchIndex = vi.fn().mockResolvedValue('chunks_vector_index');
    const collection = {
      listSearchIndexes,
      updateSearchIndex,
      dropSearchIndex,
      createSearchIndex,
    } as unknown as Collection<Document>;
    const definition = { fields: [{ type: 'filter', path: 'embeddingProfile' }] };

    await upsertSearchIndex(collection, 'chunks_vector_index', 'vectorSearch', definition);

    expect(updateSearchIndex).toHaveBeenCalledWith('chunks_vector_index', definition);
    expect(dropSearchIndex).toHaveBeenCalledWith('chunks_vector_index');
    expect(createSearchIndex).toHaveBeenCalledWith({
      name: 'chunks_vector_index',
      type: 'vectorSearch',
      definition,
    });
    expect(listSearchIndexes).toHaveBeenCalledTimes(2);
  });

  it('does not rebuild indexes for unrelated update errors', async () => {
    const listSearchIndexes = vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          name: 'chunks_vector_index',
          type: 'vectorSearch',
          latestDefinition: { fields: [{ type: 'filter', path: 'orgId' }] },
        },
      ]),
    });
    const updateSearchIndex = vi.fn().mockRejectedValue(new Error('permission denied'));
    const dropSearchIndex = vi.fn();
    const collection = {
      listSearchIndexes,
      updateSearchIndex,
      dropSearchIndex,
    } as unknown as Collection<Document>;

    await expect(
      upsertSearchIndex(collection, 'chunks_vector_index', 'vectorSearch', {
        fields: [{ type: 'filter', path: 'embeddingProfile' }],
      }),
    ).rejects.toThrow('permission denied');
    expect(dropSearchIndex).not.toHaveBeenCalled();
  });
});
