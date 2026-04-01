# Jira Connector

Planned scripts for Jira API integration.

## Planned Scripts

| Script | Description |
|--------|-------------|
| `config.mjs` | Shared config loader — reads Jira credentials from `env.json` |
| `get-issue.mjs` | Fetch a Jira issue by key (summary, description, status, comments) |
| `create-issue.mjs` | Create a new Jira issue (bug, task, story) |
| `update-issue.mjs` | Update fields on an existing issue |
| `add-comment.mjs` | Add a comment to an issue |
| `add-attachment.mjs` | Upload a file attachment to an issue |
| `search-issues.mjs` | Run a JQL query and return matching issues |

## Usage (once implemented)

```bash
node .ai/connectors/jira/get-issue.mjs --key PROJ-123
node .ai/connectors/jira/create-issue.mjs --project PROJ --type Bug --summary "..."
node .ai/connectors/jira/search-issues.mjs --jql "project = PROJ AND status = Open"
```

## Credentials

Add your Jira API token to `.ai/connectors/env.json` under the `jira` key:

```json
{
  "jira": {
    "baseUrl": "https://yourorg.atlassian.net",
    "email": "your.email@example.com",
    "token": "YOUR_JIRA_API_TOKEN",
    "defaultProject": "PROJ"
  }
}
```

See `env.json.example` for the full expected shape.
