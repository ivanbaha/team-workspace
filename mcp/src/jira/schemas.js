export const jiraToolSchemas = [
  {
    name: "jira_issue_get",
    description: "Get Jira issue details by issue code for working on task",
    inputSchema: {
      type: "object",
      properties: {
        issue_code: {
          type: "string",
          description: "Full Jira issue code (e.g., TW-9649)",
        },
      },
      required: ["issue_code"],
    },
  },
  {
    name: "jira_attachment_get",
    description: "Fetch a single Jira attachment as base64 by its content URL",
    inputSchema: {
      type: "object",
      properties: {
        content_url: {
          type: "string",
          description: "The attachment content URL from jira_issue_get response (e.g. attachments[].contentUrl)",
        },
      },
      required: ["content_url"],
    },
  },
  {
    name: "jira_issue_create",
    description: "Create a new Jira issue [the most fresh version]",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Issue title/summary",
        },
        project: {
          type: "string",
          description: "Jira project key (default: TW)",
        },
        issuetype: {
          type: "string",
          enum: ["Task", "Bug", "Story", "Epic"],
          description: "Issue type (default: Task)",
        },
        description: {
          type: "string",
          description: "Issue description",
        },
        assignee: {
          type: "string",
          description: "Assignee username",
        },
        reporter: {
          type: "string",
          description: "Reporter username (default: zleonat)",
        },
        priority: {
          type: "string",
          enum: ["Critical", "High", "Medium", "Low"],
          description: "Issue priority (default: Medium)",
        },
        labels: {
          type: "array",
          items: { type: "string" },
          description: "List of labels",
        },
        fixVersions: {
          type: "array",
          items: { type: "string" },
          description: "List of fix version names",
        },
        affectsVersions: {
          type: "array",
          items: { type: "string" },
          description: "Affects Version/s names (for Bugs). If omitted, auto-selects the nearest unreleased version by release date",
        },
        environments: {
          type: "array",
          items: {
            type: "string",
            enum: ["test", "uat", "prod", "uat-china", "prod-china"],
          },
          description: "Environment/s (e.g. test, uat, prod, uat-china, prod-china). Auto-defaults to uat for Bugs",
        },
        sprint: {
          type: "number",
          description: "Sprint ID to assign the issue to",
        },
        team: {
          type: "string",
          enum: ["dev", "devops"],
          description: "Team alias: dev = Web team, devops = DevOps Team (default: dev)",
        },
        raw_fields: {
          type: "object",
          description: "Raw Jira fields object merged on top of all other params (highest priority)",
        },
      },
      required: ["summary"],
    },
  },
];
