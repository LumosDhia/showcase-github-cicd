// Thin client for the Cloudflare Pages Function proxy at /api/gitlab/*.
// The proxy injects GITLAB_PAT and GITLAB_PROJECT_ID server-side, so nothing
// secret ever reaches this module — it only ever talks to same-origin /api.

const BASE = '/api/gitlab';

export interface GitLabProject {
  id: number;
  name: string;
  web_url: string;
}

export interface GitLabCommit {
  id: string;
  short_id: string;
  message: string;
  web_url: string;
}

export type GitLabPipelineStatus =
  | 'created' | 'waiting_for_resource' | 'preparing' | 'pending'
  | 'running' | 'success' | 'failed' | 'canceled' | 'skipped' | 'manual' | 'scheduled';

export interface GitLabPipeline {
  id: number;
  status: GitLabPipelineStatus;
  ref: string;
  sha: string;
  web_url: string;
  created_at?: string;
}

export type GitLabJobStatus =
  | 'created' | 'pending' | 'running' | 'success' | 'failed' | 'canceled' | 'skipped' | 'manual';

export interface GitLabJob {
  id: number;
  name: string;
  stage: string;
  status: GitLabJobStatus;
  duration: number | null;
  started_at: string | null;
  finished_at: string | null;
}

class GitLabApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitLabApiError(`GitLab API ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export function checkConnection(): Promise<GitLabProject> {
  return request<GitLabProject>('');
}

export async function commitFile(
  filePath: string,
  content: string,
  commitMessage: string,
  branch = 'main',
): Promise<GitLabCommit> {
  const body = (action: 'update' | 'create') =>
    JSON.stringify({
      branch,
      commit_message: commitMessage,
      actions: [{ action, file_path: filePath, content }],
    });

  try {
    return await request<GitLabCommit>('/repository/commits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body('update'),
    });
  } catch (err) {
    // File may not exist yet on a fresh repo — fall back to creating it.
    if (err instanceof GitLabApiError && /400/.test(err.message)) {
      return request<GitLabCommit>('/repository/commits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body('create'),
      });
    }
    throw err;
  }
}

export function getPipelinesForCommit(sha: string): Promise<GitLabPipeline[]> {
  return request<GitLabPipeline[]>(`/pipelines?sha=${sha}`);
}

export function getPipeline(pipelineId: number): Promise<GitLabPipeline> {
  return request<GitLabPipeline>(`/pipelines/${pipelineId}`);
}

export function getPipelineJobs(pipelineId: number): Promise<GitLabJob[]> {
  return request<GitLabJob[]>(`/pipelines/${pipelineId}/jobs?per_page=100`);
}

export async function getJobTrace(jobId: number): Promise<string> {
  const res = await fetch(`${BASE}/jobs/${jobId}/trace`);
  if (!res.ok) throw new GitLabApiError(`Trace fetch failed: ${res.status}`);
  return res.text();
}

export function getLatestPipelines(branch = 'main'): Promise<GitLabPipeline[]> {
  return request<GitLabPipeline[]>(`/pipelines?ref=${branch}&per_page=5`);
}

export interface GitLabCommitDetail {
  id: string;
  short_id: string;
  title: string;
  author_name: string;
  created_at: string;
  message: string;
  author_email: string;
}

export function getCommits(branch = 'main'): Promise<GitLabCommitDetail[]> {
  return request<GitLabCommitDetail[]>(`/repository/commits?ref_name=${branch}&per_page=15`);
}
