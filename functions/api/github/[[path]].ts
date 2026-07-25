/// <reference types="@cloudflare/workers-types" />

interface Env {
  GITHUB_PAT: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
}

const GITHUB_API = 'https://api.github.com';

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  if (!env.GITHUB_PAT || !env.GITHUB_OWNER || !env.GITHUB_REPO) {
    return new Response(
      JSON.stringify({ message: 'Server is missing GITHUB_PAT, GITHUB_OWNER, or GITHUB_REPO environment variables.' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const raw = params.path;
  const pathParts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const suffix = pathParts.length ? `/${pathParts.join('/')}` : '';

  const incoming = new URL(request.url);
  const target = `${GITHUB_API}/repos/${encodeURIComponent(env.GITHUB_OWNER)}/${encodeURIComponent(env.GITHUB_REPO)}${suffix}${incoming.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: {
      'Authorization': `Bearer ${env.GITHUB_PAT}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'DevOps-Infinity-Loop-Proxy',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(request.method !== 'GET' && request.method !== 'HEAD' ? { 'Content-Type': 'application/json' } : {}),
    },
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  const upstream = await fetch(target, init);
  const contentType = upstream.headers.get('content-type') ?? 'application/json';

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': contentType,
      'access-control-allow-origin': '*',
    },
  });
};
