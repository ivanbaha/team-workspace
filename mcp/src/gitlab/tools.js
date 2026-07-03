import { GitLabAPI } from "./api.js";
import { logger } from "../utils/logger.js";
import { execSync } from "child_process";

export class GitLabTools {
  constructor(config) {
    this.api = new GitLabAPI(config.gitlab.baseUrl, config.gitlab.pat);
    this.currentUser = null;
  }

  async initialize() {
    try {
      this.currentUser = await this.api.getCurrentUser();
      logger.info(`Initialized GitLab tools for user: ${this.currentUser.username}`);
    } catch (error) {
      logger.error("Failed to initialize GitLab tools:", error.message);
      throw error;
    }
  }

  createResponse(success, data = null, message = "") {
    return { success, data, message };
  }

  formatUser(user) {
    return user ? { username: user.username, name: user.name } : null;
  }

  formatUsers(users) {
    return users ? users.map((user) => this.formatUser(user)) : [];
  }

  async getPendingMRs() {
    try {
      if (!this.currentUser) {
        this.currentUser = await this.api.getCurrentUser();
      }

      const params = {
        state: "opened",
        scope: "all",
        reviewer_id: this.currentUser.id,
        per_page: 100,
      };

      const mrs = await this.api.getMergeRequests(params);

      const formattedMRs = mrs.map((mr) => ({
        id: mr.id,
        iid: mr.iid,
        project_id: mr.project_id,
        title: mr.title,
        description: mr.description,
        author: this.formatUser(mr.author),
        created_at: mr.created_at,
        updated_at: mr.updated_at,
        web_url: mr.web_url,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        has_conflicts: mr.has_conflicts,
        draft: mr.draft,
      }));

      return this.createResponse(true, formattedMRs, `Found ${formattedMRs.length} pending MRs`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async getMRDetails(projectId, mrIid) {
    try {
      const [mr, changes, discussions] = await Promise.all([
        this.api.getMergeRequest(projectId, mrIid),
        this.api.getMergeRequestChanges(projectId, mrIid),
        this.api.getMergeRequestDiscussions(projectId, mrIid),
      ]);

      const formattedMR = {
        id: mr.id,
        iid: mr.iid,
        project_id: mr.project_id,
        title: mr.title,
        description: mr.description,
        state: mr.state,
        author: this.formatUser(mr.author),
        assignees: this.formatUsers(mr.assignees),
        reviewers: this.formatUsers(mr.reviewers),
        created_at: mr.created_at,
        updated_at: mr.updated_at,
        merged_at: mr.merged_at,
        web_url: mr.web_url,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        has_conflicts: mr.has_conflicts,
        draft: mr.draft,
        merge_status: mr.merge_status,
        pipeline: mr.pipeline,
        approvals_before_merge: mr.approvals_before_merge,
        changes: changes.changes.map((change) => ({
          old_path: change.old_path,
          new_path: change.new_path,
          a_mode: change.a_mode,
          b_mode: change.b_mode,
          new_file: change.new_file,
          renamed_file: change.renamed_file,
          deleted_file: change.deleted_file,
          diff: change.diff,
        })),
        discussions: discussions.map((discussion) => ({
          id: discussion.id,
          individual_note: discussion.individual_note,
          resolvable: discussion.resolvable,
          resolved: discussion.resolved,
          resolved_by: this.formatUser(discussion.resolved_by),
          notes: discussion.notes.map((note) => ({
            id: note.id,
            body: note.body,
            author: this.formatUser(note.author),
            created_at: note.created_at,
            updated_at: note.updated_at,
            system: note.system,
            position: note.position,
            type: note.type,
          })),
        })),
      };

      return this.createResponse(true, formattedMR, "MR details retrieved successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async postComment(projectId, mrIid, body) {
    try {
      const note = await this.api.createMergeRequestNote(projectId, mrIid, body);

      const formattedNote = {
        id: note.id,
        body: note.body,
        author: note.author,
        created_at: note.created_at,
        web_url: note.web_url,
      };

      return this.createResponse(true, formattedNote, "Comment posted successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async postLineComment(projectId, mrIid, body, filePath, lineNumber, lineType = "new") {
    try {
      // Get MR changes to obtain the diff_refs with correct SHA values
      const changes = await this.api.getMergeRequestChanges(projectId, mrIid);

      const position = {
        base_sha: changes.diff_refs.base_sha,
        start_sha: changes.diff_refs.start_sha,
        head_sha: changes.diff_refs.head_sha,
        position_type: "text",
        new_path: filePath,
        new_line: lineType === "new" ? lineNumber : null,
        old_path: filePath,
        old_line: lineType === "old" ? lineNumber : null,
      };

      const note = await this.api.createMergeRequestNote(projectId, mrIid, body, position);

      const formattedNote = {
        id: note.id,
        body: note.body,
        author: note.author,
        created_at: note.created_at,
        position: note.position,
      };

      return this.createResponse(true, formattedNote, "Line comment posted successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async approveMR(projectId, mrIid) {
    try {
      const approval = await this.api.approveMergeRequest(projectId, mrIid);
      return this.createResponse(true, approval, "MR approved successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async getProjectInfo(projectId, detailed = false) {
    try {
      const options = detailed
        ? {
            statistics: true,
            with_custom_attributes: true,
          }
        : {};

      const project = await this.api.getProject(projectId, options);

      const basicInfo = {
        id: project.id,
        name: project.name,
        path: project.path,
        path_with_namespace: project.path_with_namespace,
        description: project.description,
        default_branch: project.default_branch,
        web_url: project.web_url,
        created_at: project.created_at,
        last_activity_at: project.last_activity_at,
      };

      if (detailed) {
        basicInfo.statistics = project.statistics;
        basicInfo.merge_requests_enabled = project.merge_requests_enabled;
        basicInfo.issues_enabled = project.issues_enabled;
        basicInfo.wiki_enabled = project.wiki_enabled;
        basicInfo.visibility = project.visibility;
        basicInfo.namespace = project.namespace;
      }

      return this.createResponse(true, basicInfo, "Project info retrieved successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async getProjects(limit = 20, search = null, owned = false) {
    try {
      const params = {
        per_page: limit,
        membership: true,
      };

      if (search) {
        params.search = search;
      }

      if (owned) {
        params.owned = true;
      }

      const projects = await this.api.getProjects(params);

      const formattedProjects = projects.map((project) => ({
        id: project.id,
        name: project.name,
        path: project.path,
        path_with_namespace: project.path_with_namespace,
        description: project.description,
        web_url: project.web_url,
        default_branch: project.default_branch,
        visibility: project.visibility,
        last_activity_at: project.last_activity_at,
      }));

      return this.createResponse(true, formattedProjects, `Found ${formattedProjects.length} projects`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async getAvailableAPIs() {
    return this.createResponse(true, { message: "HTTP API has been removed. All tools are available via MCP stdio protocol." }, "No HTTP APIs available — use MCP tools directly");
  }

  async getCurrentUser() {
    try {
      if (!this.currentUser) {
        this.currentUser = await this.api.getCurrentUser();
      }

      const formattedUser = {
        id: this.currentUser.id,
        username: this.currentUser.username,
        name: this.currentUser.name,
        email: this.currentUser.email,
        state: this.currentUser.state,
        avatar_url: this.currentUser.avatar_url,
        web_url: this.currentUser.web_url,
      };

      return this.createResponse(true, formattedUser, "Current user retrieved successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async createMR(projectId, sourceBranch, targetBranch, title, options = {}) {
    try {
      const mrOptions = {};
      if (options.description) mrOptions.description = options.description;
      if (options.assignee_id) mrOptions.assignee_id = options.assignee_id;
      if (options.reviewer_ids) mrOptions.reviewer_ids = options.reviewer_ids;
      mrOptions.remove_source_branch = options.remove_source_branch !== undefined ? options.remove_source_branch : true;
      if (options.draft !== undefined) mrOptions.draft = options.draft;

      const mr = await this.api.createMergeRequest(projectId, sourceBranch, targetBranch, title, mrOptions);

      const formattedMR = {
        id: mr.id,
        iid: mr.iid,
        project_id: mr.project_id,
        title: mr.title,
        description: mr.description,
        state: mr.state,
        author: this.formatUser(mr.author),
        created_at: mr.created_at,
        web_url: mr.web_url,
        source_branch: mr.source_branch,
        target_branch: mr.target_branch,
        draft: mr.draft,
        remove_source_branch: mr.remove_source_branch,
      };

      return this.createResponse(true, formattedMR, "Merge request created successfully");
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  parsePipelineUrl(url) {
    // Matches: https://gitlab.host/group/.../project/-/pipelines/12345
    const match = url.match(/^(https?:\/\/[^/]+)\/(.*?)\/-\/pipelines\/(\d+)/);
    if (!match) throw new Error(`Cannot parse pipeline URL: ${url}`);
    return { baseUrl: match[1], projectPath: match[2], pipelineId: parseInt(match[3], 10) };
  }

  async getPipelines(pipelineUrl, projectId, options = {}) {
    try {
      if (pipelineUrl) {
        const { projectPath, pipelineId } = this.parsePipelineUrl(pipelineUrl);
        const project = await this.api.getProjectByPath(projectPath);
        const pipeline = await this.api.getPipeline(project.id, pipelineId);
        return this.createResponse(true, {
          project_id: project.id,
          project_name: project.name,
          pipelines: [this.formatPipeline(pipeline)],
        }, '1 pipeline retrieved');
      }

      if (!projectId) throw new Error('Either pipeline_url or project_id is required');

      const params = { order_by: 'id', sort: 'desc', per_page: options.per_page || 10 };
      if (options.ref) params.ref = options.ref;
      if (options.status) params.status = options.status;

      const pipelines = await this.api.getPipelines(projectId, params);
      const formatted = pipelines.map(p => this.formatPipeline(p));
      return this.createResponse(true, {
        project_id: projectId,
        pipelines: formatted,
      }, `${formatted.length} pipelines retrieved`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  formatPipeline(p) {
    return {
      id: p.id,
      status: p.status,
      ref: p.ref,
      sha: p.sha,
      source: p.source,
      created_at: p.created_at,
      updated_at: p.updated_at,
      web_url: p.web_url,
    };
  }

  async getPipelineJobs(projectId, pipelineId) {
    try {
      const jobs = await this.api.getPipelineJobs(projectId, pipelineId);
      const formatted = jobs.map(j => ({
        id: j.id,
        name: j.name,
        stage: j.stage,
        status: j.status,
        started_at: j.started_at,
        finished_at: j.finished_at,
        duration: j.duration,
        web_url: j.web_url,
      }));
      return this.createResponse(true, formatted, `${formatted.length} jobs retrieved`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async getJobLog(projectId, jobId, outputFile) {
    try {
      const log = await this.api.getJobLog(projectId, jobId);

      if (outputFile) {
        const { writeFileSync, mkdirSync } = await import('fs');
        const { dirname, isAbsolute } = await import('path');

        if (!isAbsolute(outputFile)) {
          return this.createResponse(false, null,
            `output_file must be an absolute path (got "${outputFile}"). The MCP server runs outside the workspace, so relative paths write to the wrong location. Use the full workspace path, e.g. "c:\\Users\\user\\work\\project\\output.log".`);
        }

        mkdirSync(dirname(outputFile), { recursive: true });
        writeFileSync(outputFile, log, 'utf8');
        return this.createResponse(true, {
          outputFile,
          size: log.length,
          lines: log.split('\n').length,
        }, `Job log written to ${outputFile} (${log.length} bytes, ${log.split('\n').length} lines)`);
      }

      return this.createResponse(true, { log }, 'Job log retrieved successfully');
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async retryJob(projectId, jobId) {
    try {
      const job = await this.api.retryJob(projectId, jobId);
      return this.createResponse(true, {
        id: job.id,
        name: job.name,
        stage: job.stage,
        status: job.status,
        web_url: job.web_url,
        created_at: job.created_at,
        started_at: job.started_at,
        pipeline: job.pipeline ? { id: job.pipeline.id, status: job.pipeline.status } : null,
      }, `Job '${job.name}' retried successfully (new job ID: ${job.id})`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async playJob(projectId, jobId, jobVariables = null) {
    try {
      const job = await this.api.playJob(projectId, jobId, jobVariables);
      return this.createResponse(true, {
        id: job.id,
        name: job.name,
        stage: job.stage,
        status: job.status,
        web_url: job.web_url,
        created_at: job.created_at,
        started_at: job.started_at,
        pipeline: job.pipeline ? { id: job.pipeline.id, status: job.pipeline.status } : null,
      }, `Manual job '${job.name}' triggered successfully`);
    } catch (error) {
      return this.createResponse(false, null, error.message);
    }
  }

  async safePush(projectId, branch, options = {}) {
    const { force = false, setUpstream = false, workingDir = process.cwd() } = options;

    try {
      // Validate project exists and get info
      const project = await this.api.getProject(projectId);
      const defaultBranch = project.default_branch || "main";

      // Get protected branches to prevent dangerous operations
      const protectedBranches = await this.api.getProtectedBranches(projectId);
      const protectedBranchNames = protectedBranches.map((b) => b.name);

      // Safety checks
      const errors = [];
      const warnings = [];

      // Check 1: Prevent force push to protected branches (always enforced, no bypass)
      if (force && protectedBranchNames.includes(branch)) {
        errors.push(`Cannot force push to protected branch '${branch}'`);
      }

      // Check 2: Prevent direct push to default branch (main/master)
      // allowDefaultBranch only bypasses local check, GitLab server-side protection still applies
      if (branch === defaultBranch) {
        if (!options.allowDefaultBranch) {
          errors.push(
            `Direct push to default branch '${defaultBranch}' is not allowed. Use a feature branch and create a merge request instead.`
          );
        } else {
          warnings.push(
            `Warning: Pushing to default branch '${defaultBranch}'. GitLab server-side branch protection rules still apply.`
          );
        }
      }

      // Check 3: Prevent force push without explicit confirmation
      if (force && !options.confirmForce) {
        errors.push("Force push requires explicit confirmation. Set confirmForce: true to proceed.");
      }

      // Check 4: Validate branch name format (no dangerous characters)
      const branchNameRegex = /^[a-zA-Z0-9._\-/]+$/;
      if (!branchNameRegex.test(branch)) {
        errors.push(`Invalid branch name '${branch}'. Branch names can only contain alphanumeric characters, dots, underscores, hyphens, and forward slashes.`);
      }

      if (errors.length > 0) {
        return this.createResponse(false, { errors, protectedBranches: protectedBranchNames }, errors.join("; "));
      }

      // Check if there are commits to push before attempting
      let commitsToPush = 0;
      let localBranchExists = false;
      let remoteBranchExists = false;

      try {
        // Check if local branch exists
        execSync(`git rev-parse --verify ${branch}`, {
          cwd: workingDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        localBranchExists = true;
      } catch {
        // Local branch doesn't exist
      }

      try {
        // Check if remote branch exists
        execSync(`git rev-parse --verify origin/${branch}`, {
          cwd: workingDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        remoteBranchExists = true;
      } catch {
        // Remote branch doesn't exist (new branch)
      }

      if (localBranchExists && remoteBranchExists) {
        try {
          // Count commits ahead of remote
          const countOutput = execSync(`git rev-list --count origin/${branch}..${branch}`, {
            cwd: workingDir,
            encoding: "utf8",
            stdio: ["pipe", "pipe", "pipe"],
          });
          commitsToPush = parseInt(countOutput.trim(), 10) || 0;
        } catch {
          // If comparison fails, proceed with push and let git handle it
          commitsToPush = -1; // Unknown
        }
      } else if (localBranchExists && !remoteBranchExists) {
        // New branch being pushed for the first time
        commitsToPush = -1; // Will be determined by git
      }

      // If no commits to push and not a new branch
      if (commitsToPush === 0 && !force) {
        return this.createResponse(
          true,
          {
            branch,
            project: {
              id: project.id,
              name: project.name,
              path_with_namespace: project.path_with_namespace,
            },
            commitsToPush: 0,
            status: "up-to-date",
            warnings,
          },
          `Branch '${branch}' is already up-to-date with remote. Nothing to push.`
        );
      }

      // Build git push command with safe flags only
      const pushArgs = ["git", "push"];

      if (setUpstream) {
        pushArgs.push("-u", "origin", branch);
      } else {
        pushArgs.push("origin", branch);
      }

      if (force && options.confirmForce) {
        // Use --force-with-lease instead of --force for safer force pushes
        pushArgs.push("--force-with-lease");
      }

      // Execute git push
      const command = pushArgs.join(" ");
      logger.info(`Executing safe push: ${command}`);

      let stdout = "";
      let stderr = "";

      try {
        // Git push outputs to stderr for progress, capture both
        const result = execSync(command, {
          cwd: workingDir,
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        });
        stdout = result || "";
      } catch (execError) {
        // execSync throws on non-zero exit, but git push may output to stderr even on success
        if (execError.status !== 0) {
          throw execError;
        }
        stdout = execError.stdout || "";
        stderr = execError.stderr || "";
      }

      // Parse the output to determine what happened
      const combinedOutput = (stdout + "\n" + stderr).trim();
      let status = "pushed";
      let message = `Successfully pushed to branch '${branch}'`;

      if (combinedOutput.includes("Everything up-to-date")) {
        status = "up-to-date";
        message = `Branch '${branch}' is already up-to-date with remote. Nothing was pushed.`;
      } else if (combinedOutput.includes("->")) {
        // Successful push shows "branch -> origin/branch"
        status = "pushed";
      }

      const resultData = {
        branch,
        project: {
          id: project.id,
          name: project.name,
          path_with_namespace: project.path_with_namespace,
        },
        command,
        output: combinedOutput || "No output from git",
        status,
        force: force && options.confirmForce,
        setUpstream,
        isNewBranch: !remoteBranchExists,
        warnings,
      };

      if (commitsToPush > 0) {
        resultData.commitsPushed = commitsToPush;
      }

      return this.createResponse(true, resultData, message);
    } catch (error) {
      // Handle git command errors with detailed output
      const errorMessage = error.stderr || error.stdout || error.message;

      // Provide more specific error messages
      if (errorMessage.includes("rejected")) {
        return this.createResponse(
          false,
          { gitError: errorMessage },
          `Push rejected by remote. This may be due to branch protection rules or non-fast-forward updates. Use force push with confirmation if you need to overwrite remote changes.`
        );
      }

      if (errorMessage.includes("protected branch")) {
        return this.createResponse(
          false,
          { gitError: errorMessage },
          `Push rejected: GitLab branch protection rules prevent this operation.`
        );
      }

      return this.createResponse(false, { gitError: errorMessage }, `Git push failed: ${errorMessage}`);
    }
  }
}
