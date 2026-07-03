import { JiraAPI } from "./api.js";
import { logger } from "../utils/logger.js";

const JIRA_ENVIRONMENTS = {
  "test":        { id: "331545", name: "Global/India Test" },
  "uat":         { id: "331543", name: "Global/India UAT/ACC" },
  "prod":        { id: "331544", name: "Global/India Production" },
  "uat-china":   { id: "519664", name: "China UAT/ACC" },
  "prod-china":  { id: "519665", name: "China Production" },
};

const JIRA_TEAMS = {
  dev: { id: 5492, name: "Web team" },
  devops: { id: 5491, name: "DevOps Team" },
};

export class JiraTools {
  constructor(config) {
    this.api = new JiraAPI(config.jira.baseUrl, config.jira.pat);
  }

  async initialize() {
    logger.info("Initialized Jira tools");
  }

  createResponse(success, data = null, message = "") {
    return { success, data, message };
  }

  formatIssue(json) {
    const f = json.fields;

    // Parse sprint name from the raw sprint string (customfield_11910)
    let sprint = null;
    const sprintRaw = f.customfield_11910;
    if (Array.isArray(sprintRaw) && sprintRaw.length > 0) {
      const match = sprintRaw[0].match(/name=([^,\]]+)/);
      sprint = match ? match[1] : null;
    }

    // Filter out GitLab bot auto-comments
    const comments = (f.comment?.comments ?? [])
      .filter((c) => !c.body.includes("mentioned this issue in"))
      .map((c) => ({
        id: c.id,
        author: c.author.displayName,
        created: c.created,
        body: c.body,
      }));

    // Attachment metadata only (no base64)
    const attachments = (f.attachment ?? []).map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      contentUrl: a.content,
      created: a.created,
      author: a.author?.displayName ?? null,
    }));

    // Resolve inline !filename.png! references in description to markdown image links
    const attachmentMap = Object.fromEntries(attachments.map((a) => [a.filename, a]));
    const description = (f.description ?? "").replace(/!([^|!\s]+)(?:\|[^!]*)?\!/g, (match, filename) => {
      const att = attachmentMap[filename];
      return att ? `![${filename}](${att.contentUrl})` : match;
    });

    return {
      key: json.key,
      summary: f.summary,
      status: f.status?.name ?? null,
      statusCategory: f.status?.statusCategory?.name ?? null,
      type: f.issuetype?.name ?? null,
      priority: f.priority?.name ?? null,
      description,
      assignee: f.assignee?.displayName ?? null,
      reporter: f.reporter?.displayName ?? null,
      fixVersions: (f.fixVersions ?? []).map((v) => v.name),
      sprint,
      created: f.created ?? null,
      updated: f.updated ?? null,
      dueDate: f.duedate ?? null,
      labels: f.labels ?? [],
      components: (f.components ?? []).map((c) => c.name),
      subtasks: (f.subtasks ?? []).map((s) => ({ key: s.key, summary: s.fields?.summary })),
      issueLinks: (f.issuelinks ?? []).map((l) => ({
        type: l.type?.name,
        direction: l.inwardIssue ? "inward" : "outward",
        issue: l.inwardIssue
          ? { key: l.inwardIssue.key, summary: l.inwardIssue.fields?.summary }
          : { key: l.outwardIssue?.key, summary: l.outwardIssue?.fields?.summary },
      })),
      attachments,
      comments,
    };
  }

  async getIssue(issueCode) {
    try {
      const json = await this.api.getIssue(issueCode);
      const issue = this.formatIssue(json);
      return this.createResponse(true, issue, "Issue retrieved successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async getAttachment(contentUrl) {
    try {
      const { mimeType, base64 } = await this.api.fetchAttachment(contentUrl);
      return this.createResponse(true, { contentUrl, mimeType, base64 }, "Attachment retrieved successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }
  async createIssue(params) {
      try {
        const {
          project = "TW",
          summary,
          issuetype = "Task",
          description,
          assignee,
          reporter = "zleonat",
          priority = "Medium",
          labels,
          fixVersions,
          environments,
          sprint,
          team = "dev",
          raw_fields,
        } = params;

        const fields = {
          project: { key: project },
          summary,
          issuetype: { name: issuetype },
          reporter: { name: reporter },
          priority: { name: priority },
        };

        if (description !== undefined) fields.description = description;
        if (assignee !== undefined) fields.assignee = { name: assignee };
        if (labels !== undefined) fields.labels = labels;
        if (sprint !== undefined) fields.customfield_11910 = sprint;
        if (team && JIRA_TEAMS[team]) fields.customfield_14335 = String(JIRA_TEAMS[team].id);

        // Environments (customfield_15521) — for Bugs and Tasks
        if (environments !== undefined) {
          fields.customfield_15521 = environments.map((e) => {
            const env = JIRA_ENVIRONMENTS[e];
            return env ? { id: env.id } : { id: e };
          });
        } else if (issuetype === "Bug") {
          fields.customfield_15521 = [{ id: JIRA_ENVIRONMENTS["uat"].id }];
        }

        // Affects Version — for Bugs and Tasks; auto-resolve only for Bugs
        if (fixVersions !== undefined) {
          fields.fixVersions = fixVersions.map((v) => ({ name: v }));
        }

        if (issuetype === "Bug" || issuetype === "Task") {
          const versions = await this.resolveAffectsVersion(project, params.affectsVersions);
          if (issuetype === "Bug" && versions) {
            fields.versions = versions;
          } else if (issuetype === "Task" && params.affectsVersions !== undefined && versions) {
            fields.versions = versions;
          }
        }

        const mergedFields = raw_fields ? { ...fields, ...raw_fields } : fields;

        const result = await this.api.createIssue(mergedFields);
        return this.createResponse(true, { key: result.key, id: result.id, self: result.self }, "Issue created successfully");
      } catch (error) {
        return this.createResponse(false, null, error.message);
      }
    }
  async resolveAffectsVersion(projectKey, explicit) {
    if (explicit !== undefined) {
      return explicit.map((v) => ({ name: v }));
    }
    try {
      const allVersions = await this.api.getProjectVersions(projectKey);
      const now = new Date();
      const upcoming = allVersions
        .filter((v) => !v.archived && !v.released && v.releaseDate)
        .sort((a, b) => new Date(a.releaseDate) - new Date(b.releaseDate));
      const closest = upcoming.find((v) => new Date(v.releaseDate) >= now) || upcoming[upcoming.length - 1];
      return closest ? [{ name: closest.name }] : null;
    } catch (error) {
      logger.error("Failed to auto-resolve affects version", error);
      return null;
    }
  }


}
