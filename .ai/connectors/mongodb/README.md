# MongoDB Connector

Planned scripts for MongoDB query integration.

## Planned Scripts

| Script | Description |
|--------|-------------|
| `config.mjs` | Shared config loader — reads MongoDB URIs from `env.json` |
| `find.mjs` | Run a `find` query on a given collection |
| `aggregate.mjs` | Run an aggregation pipeline |
| `count.mjs` | Count documents matching a filter |
| `get-indexes.mjs` | List indexes on a collection |

## Usage (once implemented)

```bash
node .ai/connectors/mongodb/find.mjs --env uat --db mydb --collection users --filter '{"email":"test@example.com"}'
node .ai/connectors/mongodb/aggregate.mjs --env uat --db mydb --collection orders --pipeline '[{"$match":{"status":"pending"}}]'
```

## Credentials

Add your MongoDB connection strings to `.ai/connectors/env.json` under the `mongodb` key:

```json
{
  "mongodb": {
    "environments": {
      "test": { "uri": "mongodb://user:pass@host:27017/db?authSource=admin" },
      "uat":  { "uri": "mongodb://user:pass@host:27017/db?authSource=admin" }
    }
  }
}
```

See `env.json.example` for the full expected shape.

> ⚠️ **Production safety**: Scripts must refuse to run against production without an explicit `--force-prod` flag.
