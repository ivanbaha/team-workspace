# GitLab Connector

Planned scripts for GitLab API integration.

## Planned Scripts

| Script | Description |
|--------|-------------|
| `config.mjs` | Shared config loader — reads GitLab credentials from `env.json` |
| `list-mrs.mjs` | List open/merged Merge Requests for a project |
| `get-mr.mjs` | Get details of a specific MR (diff, comments, approvals) |
| `create-mr.mjs` | Open a new Merge Request |
| `list-projects.mjs` | List accessible projects / search by name |
| `push-file.mjs` | Commit and push a single file change via the API |

## Usage (once implemented)

```bash
node .ai/connectors/gitlab/list-mrs.mjs --project my-group/my-repo --state opened
node .ai/connectors/gitlab/get-mr.mjs --project my-group/my-repo --mr 42
```

## Credentials

Add your GitLab PAT to `.ai/connectors/env.json` under the `gitlab` key:

```json
{
  "gitlab": {
    "baseUrl": "https://gitlab.example.com",
    "token": "glpat-..."
  }
}
```

See `env.json.example` for the full expected shape.
