/// <reference types="@cloudflare/workers-types" />

interface Env {
  GITLAB_PAT: string;
  GITLAB_PROJECT_ID: string;
}

const GITLAB_API = 'https://gitlab.com/api/v4';

// Wildcard proxy: /api/gitlab/<...path> -> https://gitlab.com/api/v4/projects/:id/<...path>
// Injects the PAT and project id server-side so the browser never sees them.
export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  if (!env.GITLAB_PAT || !env.GITLAB_PROJECT_ID) {
    return new Response(
      JSON.stringify({ message: 'Server is missing GITLAB_PAT / GITLAB_PROJECT_ID environment variables.' }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const raw = params.path;
  const pathParts = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const suffix = pathParts.length ? `/${pathParts.join('/')}` : '';

  const incoming = new URL(request.url);
  const target = `${GITLAB_API}/projects/${encodeURIComponent(env.GITLAB_PROJECT_ID)}${suffix}${incoming.search}`;

  const init: RequestInit = {
    method: request.method,
    headers: {
      'PRIVATE-TOKEN': env.GITLAB_PAT,
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
    headers: { 'content-type': contentType },
  });
};
