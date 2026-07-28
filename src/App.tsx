import { useEffect, useRef, useState } from 'react';
import DevOpsLoop, { StageDef, StageStatus } from './components/DevOpsLoop';
import AboutMeModal from './components/AboutMeModal';
import * as github from './api/github';
import type { GitHubJob, GitHubWorkflowRun } from './api/github';

const STAGES: StageDef[] = [
  { id: 'plan', name: 'Plan' },
  { id: 'code', name: 'Code' },
  { id: 'secret-scan', name: 'Secret Scan' },
  { id: 'sca', name: 'SCA Audit' },
  { id: 'sast-codeql', name: 'CodeQL SAST' },
  { id: 'lint-and-test', name: 'Quality Gate' },
  { id: 'build', name: 'Build' },
  { id: 'deploy', name: 'Deploy' },
];

const FILE_PATH = 'public/index.html';
const BRANCH = 'main';
const POLL_INTERVAL_MS = 2500;
const PIPELINE_DETECT_TIMEOUT_MS = 35000;

type LogKind = 'cmd' | 'info' | 'ok' | 'err' | 'muted';
interface LogLine { id: number; kind: LogKind; text: string; }

type PipelineState = 'idle' | 'running' | 'passed' | 'failed' | 'error';

interface SummaryRow { name: string; status: 'success' | 'failed' | 'skipped'; ms: number; }

const LOG_COLOR: Record<LogKind, string> = {
  cmd: 'var(--t-cmd)', info: 'var(--t-fg)', ok: 'var(--t-ok)', err: 'var(--t-err)', muted: 'var(--t-muted)',
};

const idleStageStatus = (): Record<string, StageStatus> =>
  Object.fromEntries(STAGES.map((s) => [s.id, 'idle' as StageStatus]));

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

function classifyLine(line: string): LogKind {
  const t = line.trim();
  if (!t) return 'muted';
  if (t.startsWith('$')) return 'cmd';
  if (/error|fatal|failed/i.test(t)) return 'err';
  if (/^(✓|ok|success|passed)/i.test(t)) return 'ok';
  return 'info';
}

function buildStageStatuses(jobs: GitHubJob[]): Record<string, StageStatus> {
  const statuses = idleStageStatus();
  statuses['plan'] = 'success';
  statuses['code'] = 'success';
  for (const stage of STAGES) {
    if (stage.id === 'plan' || stage.id === 'code') continue;

    const stageJobs = jobs.filter((j) => {
      const name = j.name.toLowerCase();
      if (stage.id === 'build') return name === 'build' || (name.includes('build') && !name.includes('deploy'));
      if (stage.id === 'deploy') return name.includes('deploy') || name.includes('pages');
      if (stage.id === 'secret-scan') return name.includes('secret') || name.includes('gitleaks');
      if (stage.id === 'sca') return name.includes('sca') || name.includes('audit');
      if (stage.id === 'sast-codeql') return name.includes('sast') || name.includes('codeql');
      if (stage.id === 'lint-and-test') return name.includes('quality') || name.includes('lint') || name.includes('test');
      return name.includes(stage.id.toLowerCase());
    });

    if (stageJobs.length === 0) continue;

    if (stageJobs.some((j) => j.conclusion === 'failure' || j.conclusion === 'cancelled' || j.conclusion === 'timed_out')) {
      statuses[stage.id] = 'failed';
    } else if (stageJobs.some((j) => j.status === 'in_progress' || j.status === 'queued')) {
      statuses[stage.id] = 'active';
    } else if (stageJobs.every((j) => j.conclusion === 'success' || j.conclusion === 'skipped')) {
      statuses[stage.id] = stageJobs.every((j) => j.conclusion === 'skipped') ? 'skipped' : 'success';
    }
  }
  return statuses;
}

function computeProgress(statuses: Record<string, StageStatus>): number {
  let sum = 0;
  for (const stage of STAGES) {
    const st = statuses[stage.id];
    if (st === 'success' || st === 'skipped' || st === 'failed') sum += 1;
    else if (st === 'active') sum += 0.5;
  }
  return (sum / STAGES.length) * 100;
}

export default function App() {
  const [clock, setClock] = useState('');

  const [content, setContent] = useState('<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>Simple Node Website</title>\n</head>\n<body>\n  <h1>Hello World</h1>\n  <p>Security & Delivery GitHub Actions Pipeline Active.</p>\n</body>\n</html>\n');
  const [commitCount, setCommitCount] = useState(() => {
    const saved = localStorage.getItem('commit_count');
    return saved ? parseInt(saved, 10) : 1;
  });
  const commitMsg = `Update index.html ${commitCount}`;

  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [pipelineState, setPipelineState] = useState<PipelineState>('idle');
  const [stageStatus, setStageStatus] = useState<Record<string, StageStatus>>(idleStageStatus());
  const [progress, setProgress] = useState(0);

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [tab, setTab] = useState<'output' | 'summary'>('output');
  const [pipelineUrl, setPipelineUrl] = useState<string | null>(null);

  const [showDebug, setShowDebug] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [showAboutMe, setShowAboutMe] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [showNotification, setShowNotification] = useState(false);

  useEffect(() => {
    if (showNotification) {
      const timer = setTimeout(() => {
        setShowNotification(false);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [showNotification]);

  useEffect(() => {
    github.getFileContent(FILE_PATH, BRANCH).then((liveContent) => {
      if (liveContent) setContent(liveContent);
    }).catch(() => {});
  }, []);

  const [isEditorFocused, setIsEditorFocused] = useState(false);

  useEffect(() => {
    if (pipelineState === 'idle') {
      const statuses = idleStageStatus();
      if (isEditorFocused) {
        statuses['plan'] = 'success';
        statuses['code'] = 'active';
      } else {
        statuses['plan'] = 'active';
      }
      setStageStatus(statuses);
      setProgress(computeProgress(statuses));
    }
  }, [isEditorFocused, pipelineState]);

  const [browserPos, setBrowserPos] = useState({ x: 0, y: 0 });
  const [isDraggingBrowser, setIsDraggingBrowser] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialPosRef = useRef({ x: 0, y: 0 });

  const handleBrowserPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).classList.contains('tl')) {
      return;
    }
    setIsDraggingBrowser(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    initialPosRef.current = { x: browserPos.x, y: browserPos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleBrowserPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingBrowser) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setBrowserPos({
      x: initialPosRef.current.x + dx,
      y: initialPosRef.current.y + dy,
    });
  };

  const handleBrowserPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDraggingBrowser(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const [connection, setConnection] = useState<{ state: 'unknown' | 'checking' | 'ok' | 'error'; message?: string }>({ state: 'unknown' });

  const runTokenRef = useRef(0);
  const logIdRef = useRef(0);
  const termRef = useRef<HTMLDivElement>(null);
  const traceCacheRef = useRef<Record<number, string>>({});

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, '0');
      const ap = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      setClock(`${days[d.getDay()]} ${h}:${m} ${ap}`);
    };
    tick();
    const timer = setInterval(tick, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (termRef.current && tab === 'output') termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [logs, tab]);

  const runConnectionCheck = () => {
    setConnection({ state: 'checking' });
    github
      .checkConnection()
      .then((repo) => setConnection({ state: 'ok', message: `Connected to ${repo.full_name || repo.name}` }))
      .catch((err: Error) => setConnection({ state: 'error', message: err.message }));
  };

  useEffect(() => {
    if (showDebug && connection.state === 'unknown') runConnectionCheck();
  }, [showDebug]);

  useEffect(() => {
    let active = true;
    const checkActivePipeline = async () => {
      try {
        const list = await github.getLatestWorkflowRuns(BRANCH);
        if (!active) return;
        if (list.length > 0) {
          const latest = list[0];
          const isRunning = latest.status === 'in_progress' || latest.status === 'queued' || latest.status === 'requested' || latest.status === 'pending';

          if (isRunning) {
            setPipelineUrl(latest.html_url);
            setPipelineState('running');
            setRunning(true);
            const token = ++runTokenRef.current;
            appendLog('info', `[Auto-Detect] Found active running workflow #${latest.id} on branch ${BRANCH}`);
            pollPipeline(latest.id, token).catch(() => {});
          }
        }
      } catch (err) {
        console.error('Failed to auto-load latest workflow run:', err);
      }
    };
    checkActivePipeline();
    return () => { active = false; };
  }, []);

  const appendLog = (kind: LogKind, text: string) => {
    logIdRef.current += 1;
    setLogs((prev) => [...prev, { id: logIdRef.current, kind, text }].slice(-500));
  };

  const resetRun = () => {
    setLogs([]);
    setSummary([]);
    const statuses = idleStageStatus();
    statuses['plan'] = 'success';
    statuses['code'] = 'success';
    setStageStatus(statuses);
    setProgress(computeProgress(statuses));
    setPipelineUrl(null);
    setDone(false);
  };

  const pollTrace = async (jobId: number, token: number) => {
    let text: string;
    try {
      text = stripAnsi(await github.getJobTrace(jobId));
    } catch {
      return;
    }
    if (token !== runTokenRef.current) return;
    const prev = traceCacheRef.current[jobId] ?? '';
    if (text.length <= prev.length) return;
    const added = text.slice(prev.length);
    traceCacheRef.current[jobId] = text;
    added
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .forEach((line) => appendLog(classifyLine(line), line));
  };

  const waitForPipeline = async (sha: string, token: number): Promise<GitHubWorkflowRun> => {
    const deadline = Date.now() + PIPELINE_DETECT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (token !== runTokenRef.current) throw new Error('cancelled');
      const runs = await github.getWorkflowRunsForCommit(sha);
      if (runs.length > 0) return runs[0];
      await sleep(1500);
    }
    throw new Error(`No workflow run appeared for commit ${sha.slice(0, 7)} within ${PIPELINE_DETECT_TIMEOUT_MS / 1000}s`);
  };

  const buildSummary = (jobs: GitHubJob[]) => {
    const rows: SummaryRow[] = STAGES.flatMap((stage) =>
      jobs
        .filter((j) => {
          const name = j.name.toLowerCase();
          if (stage.id === 'build') return name === 'build' || (name.includes('build') && !name.includes('deploy'));
          if (stage.id === 'deploy') return name.includes('deploy') || name.includes('pages');
          if (stage.id === 'secret-scan') return name.includes('secret') || name.includes('gitleaks');
          if (stage.id === 'sca') return name.includes('sca') || name.includes('audit');
          if (stage.id === 'sast-codeql') return name.includes('sast') || name.includes('codeql');
          if (stage.id === 'lint-and-test') return name.includes('quality') || name.includes('lint') || name.includes('test');
          return name.includes(stage.id.toLowerCase());
        })
        .map((j) => {
          const startTime = j.started_at ? new Date(j.started_at).getTime() : 0;
          const endTime = j.completed_at ? new Date(j.completed_at).getTime() : Date.now();
          const ms = Math.max(0, endTime - startTime);

          let status: SummaryRow['status'] = 'failed';
          if (j.conclusion === 'success') status = 'success';
          else if (j.conclusion === 'skipped') status = 'skipped';

          return {
            name: `${stage.name} · ${j.name}`,
            status,
            ms,
          };
        }),
    );
    setSummary(rows);
  };

  const pollPipeline = async (runId: number, token: number) => {
    let activeJobId: number | null = null;
    try {
      for (;;) {
        if (token !== runTokenRef.current) return;
        const [run, jobs] = await Promise.all([github.getWorkflowRun(runId), github.getWorkflowJobs(runId)]);
        if (token !== runTokenRef.current) return;

        const statuses = buildStageStatuses(jobs);
        setStageStatus(statuses);
        setProgress(computeProgress(statuses));

        const runningJob = jobs.find((j) => j.status === 'in_progress');
        if (runningJob) {
          if (runningJob.id !== activeJobId) {
            activeJobId = runningJob.id;
            traceCacheRef.current[runningJob.id] = '';
            appendLog('cmd', `$ tail -f job #${runningJob.id} (${runningJob.name})`);
          }
          await pollTrace(runningJob.id, token);
        }

        const terminal = run.status === 'completed';
        if (terminal) {
          setProgress(100);
          buildSummary(jobs);
          const isPassed = run.conclusion === 'success';
          setPipelineState(isPassed ? 'passed' : 'failed');
          appendLog(isPassed ? 'ok' : 'err', `✓ workflow run ${run.conclusion || 'completed'}`);
          if (isPassed) {
            setShowNotification(true);
            setIframeKey((k) => k + 1);
          }
          return;
        }
        await sleep(POLL_INTERVAL_MS);
      }
    } finally {
      if (token === runTokenRef.current) {
        setRunning(false);
        setDone(true);
        setTab('summary');
      }
    }
  };

  const pushAndRun = async () => {
    if (running) return;
    const msg = commitMsg.trim();
    if (!msg) return;

    const token = ++runTokenRef.current;
    resetRun();
    setRunning(true);
    setPipelineState('running');
    setTab('output');

    appendLog('cmd', `$ git add ${FILE_PATH}`);
    appendLog('cmd', `$ git commit -m "${msg}"`);

    try {
      const commit = await github.commitFile(FILE_PATH, content, msg, BRANCH);
      if (token !== runTokenRef.current) return;
      setCommitCount((prev) => {
        const next = prev + 1;
        localStorage.setItem('commit_count', String(next));
        return next;
      });
      appendLog('info', `[${BRANCH} ${commit.short_id}] ${msg}`);
      appendLog('cmd', `$ git push origin ${BRANCH}`);
      appendLog('ok', `remote: commit ${commit.short_id} pushed to GitHub`);

      const run = await waitForPipeline(commit.sha, token);
      if (token !== runTokenRef.current) return;
      setPipelineUrl(run.html_url);
      appendLog('muted', `   → ${run.html_url}`);

      await pollPipeline(run.id, token);
    } catch (err) {
      if (token !== runTokenRef.current) return;
      appendLog('err', `✕ ${(err as Error).message}`);
      setPipelineState('error');
    } finally {
      if (token === runTokenRef.current) {
        setRunning(false);
        setDone(true);
        setTab('summary');
      }
    }
  };

  useEffect(() => () => { runTokenRef.current += 1; }, []);

  const statusMap: Record<PipelineState, { text: string; dot: string; anim: string }> = {
    idle: { text: 'Idle', dot: 'var(--faint)', anim: 'none' },
    running: { text: 'Running', dot: 'var(--accent)', anim: 'blink 1s steps(1) infinite' },
    passed: { text: 'Passed', dot: 'var(--ok)', anim: 'none' },
    failed: { text: 'Failed', dot: 'var(--err)', anim: 'none' },
    error: { text: 'Error', dot: 'var(--err)', anim: 'none' },
  };
  const status = statusMap[pipelineState];

  const emptyMsg = !commitMsg.trim();
  const pushDisabled = running || emptyMsg;
  const contentLines = content.split('\n').length;
  const totalMs = summary.reduce((a, r) => a + r.ms, 0);
  const failedSummary = summary.some((r) => r.status === 'failed');
  const summaryVerdict = summary.length ? (failedSummary ? 'Pipeline halted' : 'Published live to GitHub Pages') : '';
  const sumGlyph: Record<SummaryRow['status'], string> = { success: '✓', failed: '✕', skipped: '–' };
  const sumColor: Record<SummaryRow['status'], string> = { success: 'var(--t-ok)', failed: 'var(--t-err)', skipped: 'var(--t-muted)' };

  return (
    <div className="app-root" data-theme="dark">
      <div className="wallpaper">
        <div className="wallpaper-glow" />
        <div className="wallpaper-shade" />
        <svg viewBox="0 0 1440 500" preserveAspectRatio="none" className="wallpaper-hills">
          <path d="M0 210 C 280 150 520 195 760 165 C 1010 135 1230 185 1440 150 L1440 500 L0 500 Z" fill="#2c5f66" opacity="0.55" />
          <path d="M0 280 C 260 225 500 268 780 250 C 1060 232 1250 272 1440 255 L1440 500 L0 500 Z" fill="#20494c" opacity="0.8" />
          <path d="M0 360 C 320 315 640 342 940 326 C 1160 315 1320 344 1440 335 L1440 500 L0 500 Z" fill="#132e2c" />
        </svg>
      </div>

      <header className="menubar">
        <span className="menubar-title">GitHub Actions Delivery Pipeline</span>
        {['File', 'Edit', 'View'].map((m) => (
          <span key={m} className="menubar-item">{m}</span>
        ))}
        <span className="menubar-item" onClick={() => setShowAboutMe(true)} style={{ fontWeight: 600, color: '#38bdf8' }}>About Me</span>
        <span className="menubar-item" onClick={() => { setBrowserPos({ x: 0, y: 0 }); setShowBrowser(true); }}>Browser</span>
        <div className="menubar-spacer" />
        <span className="menubar-status">
          <span className="tl" style={{ width: 7, height: 7, background: status.dot, animation: status.anim }} />
          {status.text}
        </span>
        <span className="menubar-divider" />
        <span className="menubar-action" onClick={() => setShowDebug(true)}>Debug</span>
        <span className="menubar-clock">{clock}</span>
      </header>

      <main className="main-grid">
        <div className="col-left">
          <section className="window">
            <div className="window-titlebar">
              <div className="window-titlebar-dots">
                <span className="tl" style={{ background: '#ff5f57' }} />
                <span className="tl" style={{ background: '#febc2e' }} />
                <span className="tl" style={{ background: '#28c840' }} />
              </div>
              <button
                onClick={() => setShowAboutMe(true)}
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#38bdf8',
                  border: '1px solid rgba(56, 189, 248, 0.4)',
                  padding: '2px 8px',
                  borderRadius: '5px',
                  fontSize: '0.75rem',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginLeft: '8px'
                }}
              >
                About Me
              </button>
              <span className="window-titlebar-label">pipeline — github actions loop</span>
            </div>
            <div className="window-body">
              <DevOpsLoop stages={STAGES} statuses={stageStatus} progress={progress} />
            </div>
          </section>

          <section className="window">
            <div className="window-titlebar">
              <div className="window-titlebar-dots">
                <span className="tl" style={{ background: '#ff5f57' }} />
                <span className="tl" style={{ background: '#febc2e' }} />
                <span className="tl" style={{ background: '#28c840' }} />
              </div>
              <span className="window-titlebar-label">publish — {FILE_PATH}</span>
            </div>
            <div className="window-body window-body--publish">
              <div className="field-box">
                <div className="field-box-header">
                  <span>content&nbsp;·&nbsp;simple-node-website ({FILE_PATH})</span>
                  <span>{contentLines} lines</span>
                </div>
                <textarea
                  className="field-textarea field-textarea--content"
                  rows={4}
                  spellCheck={false}
                  placeholder="<h1>Hello, world</h1>"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  onFocus={() => setIsEditorFocused(true)}
                  onBlur={() => setIsEditorFocused(false)}
                />
              </div>
              <div className="field-box">
                <div className="field-box-header">commit message&nbsp;·&nbsp;auto-generated</div>
                <input
                  type="text"
                  className="field-textarea field-textarea--commit"
                  value={commitMsg}
                  readOnly
                  disabled
                  style={{ cursor: 'not-allowed', opacity: 0.8 }}
                />
              </div>
              <button className="push-btn" disabled={pushDisabled} onClick={pushAndRun}>
                <span style={{ fontSize: 14, lineHeight: 1 }}>&#8593;</span>
                {running ? 'Pushing…' : done ? 'Commit & Push again' : 'Commit & Push'}
              </button>
            </div>
          </section>
        </div>

        <section className="window terminal-window">
          <div className="window-titlebar terminal-titlebar">
            <div className="window-titlebar-dots">
              <span className="tl" style={{ background: '#ff5f57' }} />
              <span className="tl" style={{ background: '#febc2e' }} />
              <span className="tl" style={{ background: '#28c840' }} />
            </div>
            <span className="window-titlebar-label terminal-titlebar-label">bash — github-actions-runner</span>
            <div className="terminal-tabs">
              <button className={`tab-btn ${tab === 'output' ? 'tab-btn--active' : ''}`} onClick={() => setTab('output')}>output</button>
              <button className={`tab-btn ${tab === 'summary' ? 'tab-btn--active' : ''}`} onClick={() => setTab('summary')}>summary</button>
            </div>
          </div>

          {tab === 'output' && (
            <div ref={termRef} className="terminal-output">
              {logs.map((l) => (
                <div key={l.id} className="terminal-output-line" style={{ color: LOG_COLOR[l.kind] }}>{l.text}</div>
              ))}
              {running && <div><span className="terminal-cursor blink-cursor" /></div>}
              {logs.length === 0 && <div className="terminal-idle">$ idle — edit index.html, then press Commit &amp; Push to trigger GitHub Actions.</div>}
            </div>
          )}

          {tab === 'summary' && (
            <div className="terminal-summary">
              <div className="summary-header"><span>stage</span><span>status · time</span></div>
              {summary.map((row, i) => (
                <div key={i} className="summary-row">
                  <span className="summary-row-name">
                    <span className="summary-row-dot" style={{ color: sumColor[row.status] }}>{sumGlyph[row.status]}</span>
                    {row.name}
                  </span>
                  <span className="summary-row-right" style={{ color: sumColor[row.status] }}>
                    {row.status === 'skipped' ? 'skipped' : `${row.status} · ${(row.ms / 1000).toFixed(1)}s`}
                  </span>
                </div>
              ))}
              {summary.length > 0 && (
                <div className="summary-total">
                  <span>{summaryVerdict}</span>
                  <span>{totalMs ? `total ${(totalMs / 1000).toFixed(1)}s` : ''}</span>
                </div>
              )}
              {pipelineUrl && (
                <div style={{ marginTop: 12 }}>
                  <a href={pipelineUrl} target="_blank" rel="noreferrer">View workflow run on GitHub →</a>
                </div>
              )}
            </div>
          )}
        </section>
      </main>

      {showBrowser && (
        <div className="browser-overlay" onClick={() => setShowBrowser(false)}>
          <div
            className="window browser-window"
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: `translate(${browserPos.x}px, ${browserPos.y}px)`,
              transition: isDraggingBrowser ? 'none' : 'transform 0.1s ease-out'
            }}
          >
            <div
              className="window-titlebar"
              style={{ cursor: 'move', userSelect: 'none' }}
              onPointerDown={handleBrowserPointerDown}
              onPointerMove={handleBrowserPointerMove}
              onPointerUp={handleBrowserPointerUp}
            >
              <div className="window-titlebar-dots">
                <span className="tl" style={{ background: '#ff5f57', cursor: 'pointer' }} onClick={() => setShowBrowser(false)} />
                <span className="tl" style={{ background: '#febc2e' }} />
                <span className="tl" style={{ background: '#28c840' }} />
              </div>
              <span className="window-titlebar-label">Live Preview — LumosDhia.github.io/simple-node-website</span>
            </div>

            <div className="browser-address-bar">
              <button className="browser-nav-btn" onClick={() => setIframeKey(k => k + 1)} title="Refresh">⟳</button>

              <div className="browser-url-input">
                https://LumosDhia.github.io/simple-node-website/
              </div>
              <a
                href="https://github.com/LumosDhia/simple-node-website"
                target="_blank"
                rel="noreferrer"
                className="browser-nav-btn"
                style={{ textDecoration: 'none' }}
                title="Open GitHub Repository"
              >
                ↗
              </a>
            </div>

            <div className="browser-body">
              <iframe
                key={iframeKey}
                src="https://LumosDhia.github.io/simple-node-website/"
                className="browser-iframe"
                title="Live Preview"
                style={{ background: '#fff' }}
              />
            </div>
          </div>
        </div>
      )}

      {showDebug && (
        <div className="debug-overlay" onClick={() => setShowDebug(false)}>
          <div className="debug-modal" onClick={(e) => e.stopPropagation()}>
            <div className="debug-modal-header">
              <span className="debug-modal-title">Connection debug</span>
              <button className="debug-modal-close" onClick={() => setShowDebug(false)}>✕</button>
            </div>
            <div className="debug-modal-body">
              <div className="debug-row">
                <span className="debug-row-label">GitHub proxy</span>
                <span className="debug-row-value">
                  <span className={`status-dot status-dot--${connection.state}`} />
                  {connection.state === 'checking' ? 'checking…' : connection.message ?? 'unknown'}
                </span>
              </div>
              <div className="debug-row">
                <span className="debug-row-label">Target repository</span>
                <span className="debug-row-value">LumosDhia/simple-node-website</span>
              </div>
              <div className="debug-row">
                <span className="debug-row-label">Target file</span>
                <span className="debug-row-value">{FILE_PATH}</span>
              </div>
              <div className="debug-row">
                <span className="debug-row-label">Branch</span>
                <span className="debug-row-value">{BRANCH}</span>
              </div>
              <div className="debug-row">
                <span className="debug-row-label">Poll interval</span>
                <span className="debug-row-value">{POLL_INTERVAL_MS}ms</span>
              </div>
              <button className="debug-recheck-btn" onClick={runConnectionCheck}>Recheck connection</button>
            </div>
          </div>
        </div>
      )}
      {showNotification && (
        <div className="macos-notification" onClick={() => { setShowNotification(false); setBrowserPos({ x: 0, y: 0 }); setShowBrowser(true); }}>
          <div className="macos-notification-icon-container" style={{ background: 'transparent', border: 'none', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg viewBox="0 0 64 64" width="36" height="36" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))' }}>
              <defs>
                <linearGradient id="safariGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00d2ff" />
                  <stop offset="100%" stopColor="#0066ff" />
                </linearGradient>
              </defs>
              <circle cx="32" cy="32" r="30" fill="url(#safariGrad)" />
              <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
              {[...Array(12)].map((_, i) => {
                const angle = (i * 30 * Math.PI) / 180;
                return (
                  <line
                    key={i}
                    x1={32 + Math.cos(angle) * 22}
                    y1={32 + Math.sin(angle) * 22}
                    x2={32 + Math.cos(angle) * 24}
                    y2={32 + Math.sin(angle) * 24}
                    stroke="rgba(255,255,255,0.65)"
                    strokeWidth="1"
                  />
                );
              })}
              <g transform="rotate(45 32 32)">
                <path d="M32 9 L35.5 32 L32 32 Z" fill="#ff3b30" />
                <path d="M32 9 L28.5 32 L32 32 Z" fill="#ff453a" />
                <path d="M32 55 L35.5 32 L32 32 Z" fill="#f2f2f7" />
                <path d="M32 55 L28.5 32 L32 32 Z" fill="#e5e5ea" />
              </g>
              <circle cx="32" cy="32" r="2.5" fill="#fff" />
            </svg>
          </div>
          <div className="macos-notification-content">
            <div className="macos-notification-header">
              <span className="macos-notification-title">Deployment Successful</span>
              <span className="macos-notification-time">now</span>
            </div>
            <div className="macos-notification-body">
              LumosDhia.github.io/simple-node-website is live! Click to open the Live Preview.
            </div>
          </div>
          <button className="macos-notification-close" onClick={(e) => { e.stopPropagation(); setShowNotification(false); }}>✕</button>
        </div>
      )}
      {showAboutMe && <AboutMeModal onClose={() => setShowAboutMe(false)} />}
    </div>
  );
}
