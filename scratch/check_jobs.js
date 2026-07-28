import fs from 'fs';
import path from 'path';
import https from 'https';

// 1. Read environment variables from .dev.vars
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
} catch (err) {
  console.error('Failed to read .dev.vars:', err);
  process.exit(1);
}

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
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`GitLab API ${res.statusCode}: ${body}`));
        } else {
          resolve(JSON.parse(body));
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  try {
    console.log(`Checking latest pipelines for Project ID: ${GITLAB_PROJECT_ID}`);
    const pipelines = await request('/pipelines?per_page=1');
    if (pipelines.length === 0) {
      console.log('No pipelines found.');
      return;
    }
    const latest = pipelines[0];
    console.log(`Latest Pipeline ID: ${latest.id}, Status: ${latest.status}, URL: ${latest.web_url}`);
    
    console.log('Fetching jobs...');
    const jobs = await request(`/pipelines/${latest.id}/jobs`);
    const failedJobs = jobs.filter(j => j.status === 'failed');
    if (failedJobs.length === 0) {
      console.log('No failed jobs in this pipeline.');
      console.log('Jobs status summary:');
      jobs.forEach(j => console.log(` - Job #${j.id} (${j.name}): ${j.status}`));
      return;
    }

    for (const job of failedJobs) {
      console.log(`\n==================================================`);
      console.log(`FAILED JOB: ${job.name} (ID: ${job.id})`);
      console.log(`==================================================`);
      // Fetch trace
      const trace = await new Promise((resolve, reject) => {
        const options = {
          hostname: 'gitlab.com',
          path: `/api/v4/projects/${encodeURIComponent(GITLAB_PROJECT_ID)}/jobs/${job.id}/trace`,
          headers: { 'PRIVATE-TOKEN': GITLAB_PAT }
        };
        https.get(options, (res) => {
          let body = '';
          res.on('data', (chunk) => body += chunk);
          res.on('end', () => resolve(body));
        }).on('error', reject);
      });
      console.log(trace.slice(-1500)); // Print last 1500 chars of trace
    }
  } catch (err) {
    console.error('Error running check:', err);
  }
}

run();
