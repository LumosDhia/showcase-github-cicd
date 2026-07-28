// Thin client for the Cloudflare / local proxy at /api/github/*.
// Interacts with GitHub REST API v3 for repos and actions.

const BASE = '/api/github';

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
}

export interface GitHubCommitAuthor {
  name: string;
  email: string;
  date: string;
}

export interface GitHubCommitDetail {
  sha: string;
  commit: {
    author: GitHubCommitAuthor;
    message: string;
  };
  html_url: string;
}

export type GitHubWorkflowStatus = 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending';
export type GitHubWorkflowConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | 'skipped' | null;

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  head_sha: string;
  status: GitHubWorkflowStatus;
  conclusion: GitHubWorkflowConclusion;
  html_url: string;
  created_at: string;
  updated_at: string;
  jobs_url: string;
}

export interface GitHubJob {
  id: number;
  run_id: number;
  name: string;
  status: GitHubWorkflowStatus;
  conclusion: GitHubWorkflowConclusion;
  started_at: string;
  completed_at: string | null;
  html_url: string;
}

class GitHubApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GitHubApiError(`GitHub API ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export function checkConnection(): Promise<GitHubRepo> {
  return request<GitHubRepo>('');
}

export function utf8ToBase64(str: string): string {
  return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
}

export async function getFileContent(filePath: string, branch = 'main'): Promise<string | null> {
  try {
    const fileInfo = await request<{ content: string; encoding: string }>(`/contents/${filePath}?ref=${branch}`);
    if (fileInfo.content && fileInfo.encoding === 'base64') {
      const cleanBase64 = fileInfo.content.replace(/\n/g, '');
      const binary = atob(cleanBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return new TextDecoder('utf-8').decode(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

export async function getFileSha(filePath: string, branch = 'main'): Promise<string | null> {
  try {
    const fileInfo = await request<{ sha: string }>(`/contents/${filePath}?ref=${branch}`);
    return fileInfo.sha;
  } catch {
    return null;
  }
}

export async function commitFile(
  filePath: string,
  content: string,
  commitMessage: string,
  branch = 'main',
): Promise<{ sha: string; short_id: string }> {
  const currentSha = await getFileSha(filePath, branch);
  const base64Content = utf8ToBase64(content);

  const payload: { message: string; content: string; branch: string; sha?: string } = {
    message: commitMessage,
    content: base64Content,
    branch,
  };

  if (currentSha) {
    payload.sha = currentSha;
  }

  const res = await request<{ commit: { sha: string } }>(`/contents/${filePath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const sha = res.commit.sha;
  return {
    sha,
    short_id: sha.slice(0, 7),
  };
}

export async function getWorkflowRunsForCommit(sha: string): Promise<GitHubWorkflowRun[]> {
  const res = await request<{ workflow_runs: GitHubWorkflowRun[] }>(`/actions/runs?head_sha=${sha}`);
  return res.workflow_runs || [];
}

export async function getWorkflowRun(runId: number): Promise<GitHubWorkflowRun> {
  return request<GitHubWorkflowRun>(`/actions/runs/${runId}`);
}

export async function getWorkflowJobs(runId: number): Promise<GitHubJob[]> {
  const res = await request<{ jobs: GitHubJob[] }>(`/actions/runs/${runId}/jobs`);
  return res.jobs || [];
}

export async function getJobTrace(jobId: number): Promise<string> {
  const res = await fetch(`${BASE}/actions/jobs/${jobId}/logs`);
  if (!res.ok) throw new GitHubApiError(`Job log fetch failed: ${res.status}`);
  return res.text();
}

export async function getLatestWorkflowRuns(branch = 'main'): Promise<GitHubWorkflowRun[]> {
  const res = await request<{ workflow_runs: GitHubWorkflowRun[] }>(`/actions/runs?branch=${branch}&per_page=5`);
  return res.workflow_runs || [];
}
