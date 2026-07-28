import fs from 'fs';
import https from 'https';

let GITLAB_PROJECT_ID = '';
let GITLAB_PAT = '';

try {
  const content = fs.readFileSync('.dev.vars', 'utf-8');
  content.split('\n').forEach((line) => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (match) {
      const key = match[1];
      let val = match[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key === 'GITLAB_PROJECT_ID') GITLAB_PROJECT_ID = val;
      if (key === 'GITLAB_PAT') GITLAB_PAT = val;
    }
  });
} catch (err) {}

function request(urlPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'gitlab.com',
      path: `/api/v4/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}${urlPath}`,
      headers: {
        'PRIVATE-TOKEN': GITLAB_PAT,
        'Accept': 'application/json'
      }
    };
    https.get(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function run() {
  const detail = await request('/pipelines/2683030803');
  console.log('Pipeline details:', detail);
  const jobs = await request('/pipelines/2683030803/jobs');
  console.log('Jobs:', jobs);
}

run();
