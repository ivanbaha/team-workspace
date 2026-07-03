export const gitlabToolSchemas = [
  {
    name: "gitlab_get_pending_mrs",
    description: "Fetch merge requests where user is assigned as reviewer",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "gitlab_get_mr_details",
    description: "Get specific merge request information, metadata, and file changes",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        mr_iid: {
          type: "number",
          description: "Merge request internal ID",
        },
      },
      required: ["project_id", "mr_iid"],
    },
  },
  {
    name: "gitlab_post_comment",
    description: "Add general comment to merge request",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        mr_iid: {
          type: "number",
          description: "Merge request internal ID",
        },
        body: {
          type: "string",
          description: "Comment text",
        },
      },
      required: ["project_id", "mr_iid", "body"],
    },
  },
  {
    name: "gitlab_post_line_comment",
    description: "Add line-specific review comment to merge request",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        mr_iid: {
          type: "number",
          description: "Merge request internal ID",
        },
        body: {
          type: "string",
          description: "Comment text",
        },
        file_path: {
          type: "string",
          description: "Path to the file",
        },
        line_number: {
          type: "number",
          description: "Line number to comment on",
        },
        line_type: {
          type: "string",
          description: "Type of line (new or old)",
          enum: ["new", "old"],
          default: "new",
        },
      },
      required: ["project_id", "mr_iid", "body", "file_path", "line_number"],
    },
  },
  {
    name: "gitlab_approve_mr",
    description: "Approve merge request",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        mr_iid: {
          type: "number",
          description: "Merge request internal ID",
        },
      },
      required: ["project_id", "mr_iid"],
    },
  },
  {
    name: "gitlab_get_project_info",
    description: "Get project details and structure",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        detailed: {
          type: "boolean",
          description: "Include detailed project information",
          default: false,
        },
      },
      required: ["project_id"],
    },
  },
  {
    name: "gitlab_get_projects",
    description: "Get list of GitLab projects accessible to user",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of projects to return (default: 20)",
          default: 20,
        },
        search: {
          type: "string",
          description: "Search projects by name",
        },
        owned: {
          type: "boolean",
          description: "Only return projects owned by user",
          default: false,
        },
      },
    },
  },
  {
    name: "gitlab_get_available_apis",
    description: "Get available HTTP APIs in OpenAPI specification format",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "gitlab_get_current_user",
    description: "Get current authenticated user details including user ID",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "gitlab_create_mr",
    description: "Create a new merge request in a GitLab project",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        source_branch: {
          type: "string",
          description: "Source branch name",
        },
        target_branch: {
          type: "string",
          description: "Target branch name",
        },
        title: {
          type: "string",
          description: "Merge request title",
        },
        description: {
          type: "string",
          description: "Merge request description",
        },
        assignee_id: {
          type: "number",
          description: "Assignee user ID",
        },
        reviewer_ids: {
          type: "array",
          items: { type: "number" },
          description: "Array of reviewer user IDs",
        },
        remove_source_branch: {
          type: "boolean",
          description: "Remove source branch after merge",
          default: true,
        },
        draft: {
          type: "boolean",
          description: "Create as draft MR",
          default: false,
        },
      },
      required: ["project_id", "source_branch", "target_branch", "title"],
    },
  },
  {
    name: "gitlab_get_pipelines",
    description:
      "Get pipelines for a GitLab project. Accepts either a full pipeline URL (to fetch a specific pipeline) or a project_id with optional filters to list recent pipelines. Use this as the first step to discover pipeline IDs before fetching jobs.",
    inputSchema: {
      type: "object",
      properties: {
        pipeline_url: {
          type: "string",
          description:
            "Full GitLab pipeline URL, e.g. https://gitlab.company.internal/group/project/-/pipelines/12345. When provided, project_id and other filters are ignored.",
        },
        project_id: {
          type: "number",
          description: "GitLab project ID. Required when pipeline_url is not provided.",
        },
        ref: {
          type: "string",
          description: "Filter by branch or tag name (e.g. 'main'). Defaults to the project default branch.",
        },
        status: {
          type: "string",
          description: "Filter by pipeline status: created, waiting_for_resource, preparing, pending, running, success, failed, canceled, skipped, manual, scheduled",
        },
        per_page: {
          type: "number",
          description: "Number of pipelines to return (default: 10, max: 100)",
          default: 10,
        },
      },
    },
  },
  {
    name: "gitlab_get_pipeline_jobs",
    description: "Get all jobs for a specific pipeline, including their names, stages, statuses, and IDs. Use this after gitlab_get_pipelines to find the job you want to inspect (e.g. 'container_scanning').",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        pipeline_id: {
          type: "number",
          description: "Pipeline ID",
        },
      },
      required: ["project_id", "pipeline_id"],
    },
  },
  {
    name: "gitlab_get_job_log",
    description: "Get the raw log output of a specific pipeline job. Use this after gitlab_get_pipeline_jobs to retrieve the full log of a job (e.g. container scan output).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        job_id: {
          type: "number",
          description: "Job ID obtained from gitlab_get_pipeline_jobs",
        },
        output_file: {
          type: "string",
          description: "Optional file path to write the log to. When provided, the log is saved to disk and only metadata is returned (avoids large payloads). MUST be an absolute path starting with / or drive letter (e.g. C:\\Users\\...) — relative paths are rejected.",
        },
      },
      required: ["project_id", "job_id"],
    },
  },
  {
    name: "gitlab_retry_job",
    description: "Retry a failed or canceled pipeline job. Returns the new job details after retry.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        job_id: {
          type: "number",
          description: "Job ID to retry (must be in failed or canceled state)",
        },
      },
      required: ["project_id", "job_id"],
    },
  },
  {
    name: "gitlab_play_job",
    description: "Trigger a manual pipeline job (one with 'when: manual' in CI config). Optionally pass job variables.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID",
        },
        job_id: {
          type: "number",
          description: "Job ID to trigger (must be in manual state)",
        },
        job_variables: {
          type: "array",
          description: "Optional array of variables to pass to the job. Each item should have 'key' and 'value' properties.",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "Variable name" },
              value: { type: "string", description: "Variable value" },
            },
            required: ["key", "value"],
          },
        },
      },
      required: ["project_id", "job_id"],
    },
  },
  {
    name: "gitlab_safe_push",
    description:
      "Safely push commits to a remote Git branch with built-in protections. Prevents force pushes to protected branches, blocks direct pushes to default branch (main/master), validates branch names, and uses --force-with-lease instead of --force when force push is needed. This tool ensures safe Git operations without risking repository integrity.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "number",
          description: "GitLab project ID to validate branch protections against",
        },
        branch: {
          type: "string",
          description: "Branch name to push to",
        },
        force: {
          type: "boolean",
          description: "Use force push (will use --force-with-lease for safety). Requires confirmForce to be true.",
          default: false,
        },
        confirm_force: {
          type: "boolean",
          description: "Explicit confirmation for force push. Must be true if force is true.",
          default: false,
        },
        set_upstream: {
          type: "boolean",
          description: "Set upstream tracking reference (-u flag)",
          default: false,
        },
        allow_default_branch: {
          type: "boolean",
          description: "Allow pushing directly to default branch (not recommended)",
          default: false,
        },
        working_dir: {
          type: "string",
          description: "Working directory for git command (defaults to current directory)",
        },
      },
      required: ["project_id", "branch"],
    },
  },
];
