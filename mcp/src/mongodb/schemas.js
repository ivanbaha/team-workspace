export const mongodbToolSchemas = [
  {
    name: 'mongodb_get_available',
    description: 'Test connectivity to all configured MongoDB environments and list their databases.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'mongodb_list_collections',
    description: 'List all collections in a database with estimated document counts.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: { type: 'string', description: 'MongoDB environment (e.g. "test", "uat")' },
        database: { type: 'string', description: 'Database name' },
      },
      required: ['environment', 'database'],
    },
  },
  {
    name: 'mongodb_find',
    description: 'Run a find query on a collection. Supports filter, projection, sort, skip and limit.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: { type: 'string', description: 'MongoDB environment (e.g. "test", "uat")' },
        database: { type: 'string', description: 'Database name' },
        collection: { type: 'string', description: 'Collection name' },
        filter: { type: 'object', description: 'MongoDB query filter (default: {})' },
        projection: { type: 'object', description: 'Fields to include/exclude' },
        sort: { type: 'object', description: 'Sort specification e.g. {"createdAt": -1}' },
        limit: { type: 'number', description: 'Max documents to return (default: 20, max: 200)', default: 20 },
        skip: { type: 'number', description: 'Number of documents to skip (default: 0)', default: 0 },
      },
      required: ['environment', 'database', 'collection'],
    },
  },
  {
    name: 'mongodb_count',
    description: 'Count documents in a collection matching an optional filter.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: { type: 'string', description: 'MongoDB environment (e.g. "test", "uat")' },
        database: { type: 'string', description: 'Database name' },
        collection: { type: 'string', description: 'Collection name' },
        filter: { type: 'object', description: 'MongoDB query filter (default: {})' },
      },
      required: ['environment', 'database', 'collection'],
    },
  },
  {
    name: 'mongodb_aggregate',
    description:
      'Run a read-only aggregation pipeline on a collection. ' +
      'Only read-only stages are allowed: $match, $group, $sort, $limit, $skip, $project, ' +
      '$unwind, $lookup, $count, $addFields, $replaceRoot, $facet, $bucket, $bucketAuto, ' +
      '$sample, $sortByCount, $replaceWith, $set, $unset.',
    inputSchema: {
      type: 'object',
      properties: {
        environment: { type: 'string', description: 'MongoDB environment (e.g. "test", "uat")' },
        database: { type: 'string', description: 'Database name' },
        collection: { type: 'string', description: 'Collection name' },
        pipeline: {
          type: 'array',
          description: 'Aggregation pipeline stages',
          items: { type: 'object' },
        },
      },
      required: ['environment', 'database', 'collection', 'pipeline'],
    },
  },
];
