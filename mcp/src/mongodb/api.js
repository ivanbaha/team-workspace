import { MongoClient } from 'mongodb';
import { logger } from '../utils/logger.js';

const READONLY_PIPELINE_STAGES = new Set([
  '$match', '$group', '$sort', '$limit', '$skip', '$project',
  '$unwind', '$lookup', '$count', '$addFields', '$replaceRoot',
  '$facet', '$bucket', '$bucketAuto', '$sample', '$sortByCount',
  '$replaceWith', '$set', '$unset',
]);

export class MongoDBAPI {
  constructor(connectionString) {
    this.connectionString = connectionString;
    this.client = null;
  }

  async connect() {
    if (!this.client) {
      this.client = new MongoClient(this.connectionString, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await this.client.connect();
    }
    return this.client;
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  async ping() {
    const client = await this.connect();
    await client.db('admin').command({ ping: 1 });
  }

  async listDatabases() {
    const client = await this.connect();
    const result = await client.db('admin').admin().listDatabases();
    return result.databases;
  }

  async listCollections(database) {
    const client = await this.connect();
    const db = client.db(database);
    const collections = await db.listCollections().toArray();
    const withCounts = await Promise.all(
      collections.map(async (col) => {
        const count = await db.collection(col.name).estimatedDocumentCount();
        return { name: col.name, type: col.type, count };
      })
    );
    return withCounts;
  }

  async find(database, collection, { filter = {}, projection, sort, limit = 20, skip = 0 } = {}) {
    const client = await this.connect();
    const cursor = client.db(database).collection(collection)
      .find(filter, { projection })
      .skip(skip)
      .limit(limit);
    if (sort) cursor.sort(sort);
    return cursor.toArray();
  }

  async count(database, collection, filter = {}) {
    const client = await this.connect();
    return client.db(database).collection(collection).countDocuments(filter);
  }

  async aggregate(database, collection, pipeline) {
    this._validatePipeline(pipeline);
    const client = await this.connect();
    return client.db(database).collection(collection).aggregate(pipeline).toArray();
  }

  _validatePipeline(pipeline) {
    if (!Array.isArray(pipeline)) {
      throw new Error('Pipeline must be an array.');
    }
    for (const stage of pipeline) {
      const keys = Object.keys(stage);
      if (keys.length !== 1) throw new Error(`Each pipeline stage must have exactly one key. Got: ${JSON.stringify(keys)}`);
      const op = keys[0];
      if (!READONLY_PIPELINE_STAGES.has(op)) {
        throw new Error(`Pipeline stage "${op}" is not allowed. Only read-only stages are permitted.`);
      }
    }
  }
}
