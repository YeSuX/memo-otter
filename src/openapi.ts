export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Memo Otter API',
    version: '0.1.0',
    description: 'Memory management API for creating, listing, editing, archiving, exporting, and searching Memo Otter memories.'
  },
  servers: [
    {
      url: 'http://localhost:8787',
      description: 'Local Wrangler dev server'
    },
    {
      url: 'https://memo-otter.suxiong1998.workers.dev',
      description: 'Cloudflare Workers deployment'
    }
  ],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Health' },
    { name: 'Memories' },
    { name: 'Search' },
    { name: 'Context' },
    { name: 'Export' }
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        security: [],
        summary: 'Check service health',
        responses: {
          '200': {
            description: 'Service is running',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/HealthResponse' }
              }
            }
          }
        }
      }
    },
    '/memories': {
      get: {
        tags: ['Memories'],
        summary: 'List memories',
        parameters: [
          { name: 'project', in: 'query', schema: { type: 'string' } },
          { name: 'scope', in: 'query', schema: { $ref: '#/components/schemas/MemoryScope' } },
          { name: 'type', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/MemoryStatus' } },
          { name: 'tags', in: 'query', description: 'Comma-separated tags', schema: { type: 'string' } },
          { name: 'include_archived', in: 'query', schema: { type: 'boolean', default: false } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, minimum: 0, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0, minimum: 0 } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } }
        ],
        responses: {
          '200': {
            description: 'Memory list',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MemoryListResponse' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      },
      post: {
        tags: ['Memories'],
        summary: 'Create a memory',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateMemoryInput' }
            }
          }
        },
        responses: {
          '201': {
            description: 'Memory created',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MemoryWriteResponse' }
              }
            }
          },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      }
    },
    '/memories/{id}': {
      get: {
        tags: ['Memories'],
        summary: 'Get memory detail',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Memory detail',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MemoryDetailResponse' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/MemoryNotFound' }
        }
      },
      patch: {
        tags: ['Memories'],
        summary: 'Update a memory',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateMemoryInput' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Memory updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MemoryWriteResponse' }
              }
            }
          },
          '400': { $ref: '#/components/responses/InvalidRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/MemoryNotFound' },
          '409': { $ref: '#/components/responses/InvalidStateTransition' }
        }
      }
    },
    '/memories/{id}/archive': {
      post: {
        tags: ['Memories'],
        summary: 'Archive a memory',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ArchiveMemoryInput' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Memory archived',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ArchiveMemoryResponse' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/MemoryNotFound' }
        }
      }
    },
    '/memories/{id}/reindex': {
      post: {
        tags: ['Memories'],
        summary: 'Reindex a memory',
        description: 'Regenerate the memory embedding and upsert it into Vectorize without changing memory content.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ReindexMemoryInput' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Memory reindexed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MemoryWriteResponse' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '404': { $ref: '#/components/responses/MemoryNotFound' }
        }
      }
    },
    '/search': {
      post: {
        tags: ['Search'],
        summary: 'Search memories',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SearchInput' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Search results',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SearchResponse' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      }
    },
    '/context/{project}': {
      get: {
        tags: ['Context'],
        summary: 'Get project context memories',
        parameters: [{ name: 'project', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'Project context',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ContextResponse' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      }
    },
    '/export': {
      get: {
        tags: ['Export'],
        summary: 'Export raw D1 memory data',
        responses: {
          '200': {
            description: 'Exported data',
            content: {
              'application/json': {
                schema: { type: 'object' }
              }
            }
          },
          '401': { $ref: '#/components/responses/Unauthorized' }
        }
      }
    }
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer'
      }
    },
    responses: {
      InvalidRequest: {
        description: 'Invalid request',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      },
      Unauthorized: {
        description: 'Unauthorized',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      },
      MemoryNotFound: {
        description: 'Memory not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      },
      InvalidStateTransition: {
        description: 'Invalid state transition',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } }
      }
    },
    schemas: {
      MemoryScope: { type: 'string', enum: ['long_term', 'short_term'] },
      MemoryStatus: { type: 'string', enum: ['draft', 'active', 'canonical', 'archived'] },
      EmbeddingStatus: { type: 'string', enum: ['pending', 'indexed', 'failed', 'stale'] },
      Memory: {
        type: 'object',
        required: [
          'id',
          'title',
          'content',
          'project',
          'scope',
          'type',
          'status',
          'tags',
          'source',
          'embeddingStatus',
          'createdAt',
          'updatedAt',
          'archivedAt',
          'metadata'
        ],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string' },
          project: { type: ['string', 'null'] },
          scope: { $ref: '#/components/schemas/MemoryScope' },
          type: { type: 'string' },
          status: { $ref: '#/components/schemas/MemoryStatus' },
          tags: { type: 'array', items: { type: 'string' } },
          source: { type: ['string', 'null'] },
          embeddingStatus: { $ref: '#/components/schemas/EmbeddingStatus' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          archivedAt: { type: ['string', 'null'], format: 'date-time' },
          metadata: { type: 'object', additionalProperties: true }
        }
      },
      MemoryListItem: {
        allOf: [
          { $ref: '#/components/schemas/Memory' },
          {
            type: 'object',
            description: 'List responses omit content, archivedAt, and metadata at runtime.'
          }
        ]
      },
      MemoryEvent: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          memoryId: { type: ['string', 'null'] },
          eventType: { type: 'string', enum: ['create', 'update', 'archive', 'index', 'index_failed', 'export'] },
          before: { type: ['object', 'null'], additionalProperties: true },
          after: { type: ['object', 'null'], additionalProperties: true },
          source: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' }
        }
      },
      MemoryIndexState: {
        type: 'object',
        properties: {
          status: { $ref: '#/components/schemas/EmbeddingStatus' },
          embeddingModel: { type: ['string', 'null'] },
          vectorId: { type: ['string', 'null'] },
          contentHash: { type: ['string', 'null'] },
          indexedAt: { type: ['string', 'null'], format: 'date-time' },
          failure: {
            type: ['object', 'null'],
            properties: {
              stage: { type: ['string', 'null'], enum: ['embedding', 'vectorize', 'd1_metadata', null] },
              message: { type: ['string', 'null'] }
            }
          }
        }
      },
      MemoryWarning: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          severity: { type: 'string', enum: ['info', 'warning'] },
          message: { type: 'string' },
          relatedMemoryIds: { type: 'array', items: { type: 'string' } }
        }
      },
      CreateMemoryInput: {
        type: 'object',
        required: ['content'],
        properties: {
          title: { type: 'string', maxLength: 160 },
          content: { type: 'string', minLength: 1, maxLength: 20000 },
          project: { type: ['string', 'null'], maxLength: 120 },
          scope: { $ref: '#/components/schemas/MemoryScope' },
          type: { type: 'string', maxLength: 64 },
          status: { type: 'string', enum: ['draft', 'active', 'canonical'] },
          tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
          source: { type: 'string', maxLength: 40 },
          metadata: { type: 'object', additionalProperties: true }
        }
      },
      UpdateMemoryInput: {
        type: 'object',
        minProperties: 1,
        properties: {
          title: { type: 'string', maxLength: 160 },
          content: { type: 'string', minLength: 1, maxLength: 20000 },
          project: { type: ['string', 'null'], maxLength: 120 },
          scope: { $ref: '#/components/schemas/MemoryScope' },
          type: { type: 'string', maxLength: 64 },
          status: { $ref: '#/components/schemas/MemoryStatus' },
          tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
          metadata: { type: 'object', additionalProperties: true }
        }
      },
      ArchiveMemoryInput: {
        type: 'object',
        properties: {
          source: { type: 'string', maxLength: 40 },
          reason: { type: 'string', maxLength: 500 }
        }
      },
      ReindexMemoryInput: {
        type: 'object',
        properties: {
          source: { type: 'string', maxLength: 40 }
        },
        additionalProperties: false
      },
      MemoryWriteResponse: {
        type: 'object',
        properties: {
          memory: { $ref: '#/components/schemas/Memory' },
          indexing: { $ref: '#/components/schemas/MemoryIndexState' },
          warnings: { type: 'array', items: { $ref: '#/components/schemas/MemoryWarning' } }
        }
      },
      ArchiveMemoryResponse: {
        type: 'object',
        properties: {
          memory: { $ref: '#/components/schemas/Memory' },
          warnings: { type: 'array', items: { $ref: '#/components/schemas/MemoryWarning' } }
        }
      },
      MemoryListResponse: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { $ref: '#/components/schemas/MemoryListItem' } },
          pagination: {
            type: 'object',
            properties: {
              limit: { type: 'integer' },
              offset: { type: 'integer' },
              nextCursor: { type: ['string', 'null'] },
              hasMore: { type: 'boolean' }
            }
          }
        }
      },
      MemoryDetailResponse: {
        type: 'object',
        properties: {
          memory: { $ref: '#/components/schemas/Memory' },
          events: { type: 'array', items: { $ref: '#/components/schemas/MemoryEvent' } },
          indexing: { $ref: '#/components/schemas/MemoryIndexState' }
        }
      },
      SearchInput: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1, maxLength: 1000 },
          project: { type: ['string', 'null'], maxLength: 120 },
          type: { type: 'string', maxLength: 64 },
          status: { $ref: '#/components/schemas/MemoryStatus' },
          tags: { type: 'array', items: { type: 'string', maxLength: 40 }, maxItems: 20 },
          include_archived: { type: 'boolean', default: false },
          limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 }
        },
        additionalProperties: false
      },
      SearchResultItem: {
        type: 'object',
        required: ['id', 'title', 'snippet', 'project', 'type', 'status', 'tags', 'score', 'source', 'created_at', 'updated_at'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          snippet: { type: 'string' },
          project: { type: ['string', 'null'] },
          type: { type: 'string' },
          status: { $ref: '#/components/schemas/MemoryStatus' },
          tags: { type: 'array', items: { type: 'string' } },
          score: { type: 'number' },
          source: { type: ['string', 'null'] },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' }
        }
      },
      SearchResponse: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          results: { type: 'array', items: { $ref: '#/components/schemas/SearchResultItem' } },
          meta: {
            type: 'object',
            properties: {
              limit: { type: 'integer' },
              candidate_count: { type: 'integer' },
              returned_count: { type: 'integer' }
            }
          }
        }
      },
      ContextResponse: {
        type: 'object',
        properties: {
          project: { type: 'string' },
          memories: { type: 'array', items: { $ref: '#/components/schemas/MemoryListItem' } }
        }
      },
      HealthResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          service: { type: 'string' },
          bindings: { type: 'object', additionalProperties: { type: 'boolean' } }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          error: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
              details: { type: 'object', additionalProperties: true }
            }
          }
        }
      }
    }
  }
} as const;
