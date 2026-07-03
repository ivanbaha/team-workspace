import { logger } from '../utils/logger.js';

export class GitLabAPI {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.token = token;
    this.apiUrl = `${this.baseUrl}api/v4/`;
  }

  async request(endpoint, options = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const config = {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    };

    try {
      logger.debug(`GitLab API request: ${options.method || 'GET'} ${url}`);
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitLab API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`GitLab API request failed: ${error.message}`);
      throw error;
    }
  }

  async getCurrentUser() {
    return this.request('user');
  }

  async getMergeRequests(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`merge_requests?${query}`);
  }

  async getMergeRequest(projectId, mrIid) {
    return this.request(`projects/${projectId}/merge_requests/${mrIid}`);
  }

  async getMergeRequestChanges(projectId, mrIid) {
    return this.request(`projects/${projectId}/merge_requests/${mrIid}/changes`);
  }

  async getMergeRequestNotes(projectId, mrIid) {
    return this.request(`projects/${projectId}/merge_requests/${mrIid}/notes`);
  }

  async getMergeRequestDiscussions(projectId, mrIid) {
    return this.request(`projects/${projectId}/merge_requests/${mrIid}/discussions`);
  }

  async createMergeRequestNote(projectId, mrIid, body, position = null) {
    const data = { body };
    if (position) {
      data.position = position;
      // Use discussions endpoint for line comments
      return this.request(`projects/${projectId}/merge_requests/${mrIid}/discussions`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
    }

    return this.request(`projects/${projectId}/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async approveMergeRequest(projectId, mrIid) {
    return this.request(`projects/${projectId}/merge_requests/${mrIid}/approve`, {
      method: 'POST'
    });
  }

  async unapproveMergeRequest(projectId, mrIid) {
    return this.request(`projects/${projectId}/merge_requests/${mrIid}/unapprove`, {
      method: 'POST'
    });
  }

  async getProject(projectId, options = {}) {
    const params = new URLSearchParams(options).toString();
    return this.request(`projects/${projectId}${params ? '?' + params : ''}`);
  }

  async getProjects(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`projects?${query}`);
  }

  async getBranch(projectId, branchName) {
    return this.request(`projects/${projectId}/repository/branches/${encodeURIComponent(branchName)}`);
  }

  async createMergeRequest(projectId, sourceBranch, targetBranch, title, options = {}) {
    const data = {
      source_branch: sourceBranch,
      target_branch: targetBranch,
      title,
      ...options
    };
    return this.request(`projects/${projectId}/merge_requests`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async getProtectedBranches(projectId) {
    return this.request(`projects/${projectId}/protected_branches`);
  }

  async listBranches(projectId, search = null) {
    const params = search ? `?search=${encodeURIComponent(search)}` : '';
    return this.request(`projects/${projectId}/repository/branches${params}`);
  }

  async requestText(endpoint, options = {}) {
    const url = `${this.apiUrl}${endpoint}`;
    const config = {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        ...options.headers
      },
      ...options
    };

    try {
      logger.debug(`GitLab API request (text): GET ${url}`);
      const response = await fetch(url, config);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`GitLab API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      return await response.text();
    } catch (error) {
      logger.error(`GitLab API request failed: ${error.message}`);
      throw error;
    }
  }

  async getPipelines(projectId, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`projects/${projectId}/pipelines${query ? '?' + query : ''}`);
  }

  async getPipeline(projectId, pipelineId) {
    return this.request(`projects/${projectId}/pipelines/${pipelineId}`);
  }

  async getPipelineJobs(projectId, pipelineId) {
    return this.request(`projects/${projectId}/pipelines/${pipelineId}/jobs?per_page=100`);
  }

  async getJobLog(projectId, jobId) {
    return this.requestText(`projects/${projectId}/jobs/${jobId}/trace`);
  }

  async getProjectByPath(pathWithNamespace) {
    return this.request(`projects/${encodeURIComponent(pathWithNamespace)}`);
  }

  async retryJob(projectId, jobId) {
    return this.request(`projects/${projectId}/jobs/${jobId}/retry`, {
      method: 'POST'
    });
  }

  async playJob(projectId, jobId, variables = null) {
    const options = { method: 'POST' };
    if (variables) {
      options.body = JSON.stringify({ job_variables_attributes: variables });
    }
    return this.request(`projects/${projectId}/jobs/${jobId}/play`, options);
  }
}
