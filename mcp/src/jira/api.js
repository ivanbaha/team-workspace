import { logger } from "../utils/logger.js";

export class JiraAPI {
  constructor(baseUrl, pat) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.pat = pat;
  }

  async makeRequest(url) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.pat}`,
          Accept: "application/json",
          "User-Agent": "workspace-mcp-server",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`Jira API request failed: ${url}`, error);
      throw error;
    }
  }

  async getIssue(issueCode) {
    const url = `${this.baseUrl}/rest/api/2/issue/${issueCode}`;
    return await this.makeRequest(url);
  }

  async fetchAttachment(contentUrl) {
    try {
      const response = await fetch(contentUrl, {
        headers: {
          Authorization: `Bearer ${this.pat}`,
          "User-Agent": "workspace-mcp-server",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const mimeType = response.headers.get("content-type") || "application/octet-stream";
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return { mimeType, base64 };
    } catch (error) {
      logger.error(`Jira attachment fetch failed: ${contentUrl}`, error);
      throw error;
    }
  }
  async createIssue(fields) {
    const url = `${this.baseUrl}/rest/api/2/issue`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.pat}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "workspace-mcp-server",
        },
        body: JSON.stringify({ fields }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} — ${errorBody}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`Jira API createIssue failed`, error);
      throw error;
    }
  }
  async getProjectVersions(projectKey) {
    const url = `${this.baseUrl}/rest/api/2/project/${projectKey}/versions`;
    return await this.makeRequest(url);
  }
  async getCreateMeta(projectKey, issuetypeName) {
    const url = `${this.baseUrl}/rest/api/2/issue/createmeta?projectKeys=${projectKey}&issuetypeNames=${encodeURIComponent(issuetypeName)}&expand=projects.issuetypes.fields`;
    return await this.makeRequest(url);
  }



}
