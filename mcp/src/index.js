#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { loadConfig } from "./config.js";
import { GitLabTools } from "./gitlab/tools.js";
import { gitlabToolSchemas } from "./gitlab/schemas.js";
import { JiraTools } from "./jira/tools.js";
import { jiraToolSchemas } from "./jira/schemas.js";
import { GrafanaTools } from "./grafana/tools.js";
import { TraceTool } from "./grafana/trace-tool.js";
import { grafanaToolSchemas } from "./grafana/schemas.js";
import { MongoDBTools } from "./mongodb/tools.js";
import { mongodbToolSchemas } from "./mongodb/schemas.js";
import { DocsTools } from "./docs/tools.js";
import { DocsSearchTools } from "./docs/search.js";
import { bootstrapDocsSearch } from "./docs/bootstrap.js";
import { docsToolSchemas, docsSearchToolSchemas } from "./docs/schemas.js";
import { logger } from "./utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

class WorkspaceMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: "workspace-mcp",
        version: packageJson.version,
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.gitlabTools = null;
    this.jiraTools = null;
    this.grafanaTools = null;
    this.traceTool = null;
    this.mongodbTools = null;
    this.docsTools = null;
    this.docsSearchTools = null;
    this.setupHandlers();
  }

  setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          ...gitlabToolSchemas,
          ...jiraToolSchemas,
          ...(this.grafanaTools ? grafanaToolSchemas : []),
          ...(this.mongodbTools ? mongodbToolSchemas : []),
          ...docsToolSchemas,
          ...(this.docsSearchTools ? docsSearchToolSchemas : []),
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result;

        switch (name) {
          case "gitlab_get_pending_mrs":
            result = await this.gitlabTools.getPendingMRs();
            break;
          case "gitlab_get_mr_details":
            result = await this.gitlabTools.getMRDetails(args.project_id, args.mr_iid);
            break;
          case "gitlab_post_comment":
            result = await this.gitlabTools.postComment(args.project_id, args.mr_iid, args.body);
            break;
          case "gitlab_post_line_comment":
            result = await this.gitlabTools.postLineComment(
              args.project_id,
              args.mr_iid,
              args.body,
              args.file_path,
              args.line_number,
              args.line_type
            );
            break;
          case "gitlab_approve_mr":
            result = await this.gitlabTools.approveMR(args.project_id, args.mr_iid);
            break;
          case "gitlab_get_project_info":
            result = await this.gitlabTools.getProjectInfo(args.project_id, args.detailed);
            break;
          case "gitlab_get_projects":
            result = await this.gitlabTools.getProjects(args.limit, args.search, args.owned);
            break;
          case "gitlab_get_available_apis":
            result = await this.gitlabTools.getAvailableAPIs();
            break;
          case "gitlab_get_current_user":
            result = await this.gitlabTools.getCurrentUser();
            break;
          case "gitlab_create_mr":
            result = await this.gitlabTools.createMR(
              args.project_id,
              args.source_branch,
              args.target_branch,
              args.title,
              {
                description: args.description,
                assignee_id: args.assignee_id,
                reviewer_ids: args.reviewer_ids,
                remove_source_branch: args.remove_source_branch !== undefined ? args.remove_source_branch : true,
                draft: args.draft,
              }
            );
            break;
          case "gitlab_get_pipelines":
            result = await this.gitlabTools.getPipelines(args.pipeline_url, args.project_id, {
              ref: args.ref,
              status: args.status,
              per_page: args.per_page,
            });
            break;
          case "gitlab_get_pipeline_jobs":
            result = await this.gitlabTools.getPipelineJobs(args.project_id, args.pipeline_id);
            break;
          case "gitlab_get_job_log":
            result = await this.gitlabTools.getJobLog(args.project_id, args.job_id, args.output_file);
            break;
          case "gitlab_retry_job":
            result = await this.gitlabTools.retryJob(args.project_id, args.job_id);
            break;
          case "gitlab_play_job":
            result = await this.gitlabTools.playJob(args.project_id, args.job_id, args.job_variables);
            break;
          case "gitlab_safe_push":
            result = await this.gitlabTools.safePush(args.project_id, args.branch, {
              force: args.force,
              confirmForce: args.confirm_force,
              setUpstream: args.set_upstream,
              allowDefaultBranch: args.allow_default_branch,
              workingDir: args.working_dir,
            });
            break;
          case "jira_issue_get":
            result = await this.jiraTools.getIssue(args.issue_code);
            break;
          case "jira_attachment_get":
            result = await this.jiraTools.getAttachment(args.content_url);
            break;
          case "jira_issue_create":
            result = await this.jiraTools.createIssue(args);
            break;
          case "grafana_get_available":
            result = await this.grafanaTools.getAvailable();
            break;
          case "grafana_trace_id":
            result = await this.traceTool.trace(args);
            break;
          case "grafana_search_logs":
            result = await this.grafanaTools.searchLogs(args.environment, {
              service: args.service,
              search: args.search,
              exclude: args.exclude,
              start: args.start,
              end: args.end,
              limit: args.limit,
            });
            break;
          case "mongodb_get_available":
            result = await this.mongodbTools.getAvailable();
            break;
          case "mongodb_list_collections":
            result = await this.mongodbTools.listCollections(args.environment, args.database);
            break;
          case "mongodb_find":
            result = await this.mongodbTools.find(args.environment, args.database, args.collection, {
              filter: args.filter,
              projection: args.projection,
              sort: args.sort,
              limit: args.limit,
              skip: args.skip,
            });
            break;
          case "mongodb_count":
            result = await this.mongodbTools.count(args.environment, args.database, args.collection, args.filter);
            break;
          case "mongodb_aggregate":
            result = await this.mongodbTools.aggregate(args.environment, args.database, args.collection, args.pipeline);
            break;
          case "docs_map":
            result = this.docsTools.getMap(args.filter);
            break;
          case "docs_search":
            if (!this.docsSearchTools) {
              throw new Error("docs_search is disabled. Set DOCS_SEARCH_ENABLED=true and build the index.");
            }
            result = await this.docsSearchTools.search(args.query, args.limit);
            break;
          default:
            throw new Error(`Unknown tool: ${name}`);
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error(`Tool execution failed: ${name}`, error);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  data: null,
                  message: error.message,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async initialize() {
    try {
      const config = loadConfig();
      this.gitlabTools = new GitLabTools(config);
      await this.gitlabTools.initialize();
      this.jiraTools = new JiraTools(config);
      await this.jiraTools.initialize();
      if (config.grafana) {
        this.grafanaTools = new GrafanaTools(config.grafana);
        await this.grafanaTools.initialize();
        // Shares the GrafanaTools instance so credentials and the resolved datasource cache live in
        // exactly one place.
        this.traceTool = new TraceTool(this.grafanaTools);
      }
      if (config.mongodb) {
        this.mongodbTools = new MongoDBTools(config.mongodb);
        await this.mongodbTools.initialize();
      }
      this.docsTools = new DocsTools();
      await this.docsTools.initialize();
      if (config.docsSearch?.enabled) {
        // Auto-start Qdrant (if not already running) and trigger the daily
        // background ingest. Best-effort — never blocks the rest of the server.
        await bootstrapDocsSearch(config.docsSearch);
        this.docsSearchTools = new DocsSearchTools(config.docsSearch);
        await this.docsSearchTools.initialize();
      }
      logger.info("Workspace MCP Server initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize server:", error.message);
      process.exit(1);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info("Workspace MCP Server running on stdio");
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('version') || args.includes('--version') || args.includes('-v')) {
    console.log(packageJson.version);
    process.exit(0);
  }

  const server = new WorkspaceMCPServer();
  await server.initialize();
  await server.run();
}

if (process.argv[1] && (import.meta.url.endsWith(process.argv[1]) || process.argv[1].endsWith("index.js"))) {
  main().catch((error) => {
    logger.error("Server startup failed:", error);
    process.exit(1);
  });
}
