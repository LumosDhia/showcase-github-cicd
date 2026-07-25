import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

// 1. Read environment variables from .dev.vars
let GITHUB_OWNER = process.env.GITHUB_OWNER;
let GITHUB_REPO = process.env.GITHUB_REPO;
let GITHUB_PAT = process.env.GITHUB_PAT;

try {
  const devVarsPath = path.resolve('.dev.vars');
  if (fs.existsSync(devVarsPath)) {
    const content = fs.readFileSync(devVarsPath, 'utf-8');
    content.split('\n').forEach((line) => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key === 'GITHUB_OWNER') GITHUB_OWNER = val;
        if (key === 'GITHUB_REPO') GITHUB_REPO = val;
        if (key === 'GITHUB_PAT') GITHUB_PAT = val;
      }
    });
  }
} catch (err) {
  console.error('Failed to read .dev.vars file:', err);
}

// Fallback defaults if not set in .dev.vars
GITHUB_OWNER = GITHUB_OWNER || 'LumosDhia';
GITHUB_REPO = GITHUB_REPO || 'simple-node-website';

const PORT = 8788;
const GITHUB_API_HOST = 'api.github.com';

const server = http.createServer((req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  const urlObj = new URL(req.url || '', `http://${req.headers.host}`);
  let pathname = urlObj.pathname;

  if (!pathname.startsWith('/api/github')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Not Found: ${pathname}` }));
    return;
  }

  let suffix = pathname.slice('/api/github'.length);
  if (suffix && !suffix.startsWith('/')) {
    suffix = '/' + suffix;
  }

  const targetPath = `/repos/${encodeURIComponent(GITHUB_OWNER)}/${encodeURIComponent(GITHUB_REPO)}${suffix}${urlObj.search}`;
  const targetUrl = `https://${GITHUB_API_HOST}${targetPath}`;

  console.log(`[GitHub Proxy] ${req.method} ${pathname} -> ${targetUrl}`);

  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'DevOps-Infinity-Loop-Proxy',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (GITHUB_PAT) {
    headers['Authorization'] = `Bearer ${GITHUB_PAT}`;
  }

  if (req.headers['content-type']) {
    headers['Content-Type'] = req.headers['content-type'];
  }

  const clientReq = https.request(
    {
      hostname: GITHUB_API_HOST,
      path: targetPath,
      method: req.method,
      headers: headers,
    },
    (clientRes) => {
      // Handle redirects for job log endpoints
      if (clientRes.statusCode === 302 && clientRes.headers.location) {
        console.log(`[GitHub Proxy Redirect] -> ${clientRes.headers.location}`);
        https.get(clientRes.headers.location, (logRes) => {
          res.writeHead(logRes.statusCode || 200, {
            'content-type': logRes.headers['content-type'] || 'text/plain; charset=utf-8',
            'access-control-allow-origin': '*',
          });
          logRes.pipe(res);
        }).on('error', (err) => {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to fetch redirected logs', details: err.message }));
        });
        return;
      }

      const resHeaders = { ...clientRes.headers };
      delete resHeaders['access-control-allow-origin'];
      delete resHeaders['access-control-allow-headers'];
      delete resHeaders['access-control-allow-methods'];

      res.writeHead(clientRes.statusCode || 200, resHeaders);
      clientRes.pipe(res);
    }
  );

  clientReq.on('error', (err) => {
    console.error('[Proxy Error] Request failed:', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad Gateway proxying to GitHub', details: err.message }));
  });

  req.pipe(clientReq);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n==================================================`);
  console.log(`GitHub Proxy Server running at http://127.0.0.1:${PORT}`);
  console.log(`Targeting Repo: ${GITHUB_OWNER}/${GITHUB_REPO}`);
  console.log(`==================================================\n`);
});
