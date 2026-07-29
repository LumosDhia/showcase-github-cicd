import { useEffect, useRef, useState } from 'react';

export type StageStatus = 'idle' | 'active' | 'success' | 'failed' | 'skipped';

export interface StageDef {
  id: string;
  name: string;
  type?: 'ci' | 'cd';
}

interface NodePoint {
  x: number;
  y: number;
  lx: number;
  ly: number;
}

interface DevOpsLoopProps {
  stages: StageDef[];
  statuses: Record<string, StageStatus>;
  /** 0-100 */
  progress: number;
}

const LOOP_PATH =
  'M500 200 C 430 96 150 96 150 200 C 150 304 430 304 500 200 C 570 96 850 96 850 200 C 850 304 570 304 500 200 Z';

const GLYPH: Record<StageStatus, string> = { idle: '', active: '', success: '✓', failed: '✕', skipped: '–' };
const GLYPH_COLOR: Record<StageStatus, string> = {
  idle: 'var(--muted)', active: 'var(--accent)', success: 'var(--ok)', failed: 'var(--err)', skipped: 'var(--muted)',
};

function circleStyle(status: StageStatus) {
  switch (status) {
    case 'active':
      return { stroke: 'var(--accent)', fill: 'color-mix(in oklab,var(--accent) 16%, var(--win))', strokeWidth: 3 };
    case 'success':
      return { stroke: 'var(--ok)', fill: 'color-mix(in oklab,var(--ok) 18%, var(--win))', strokeWidth: 3 };
    case 'failed':
      return { stroke: 'var(--err)', fill: 'color-mix(in oklab,var(--err) 20%, var(--win))', strokeWidth: 3 };
    case 'skipped':
      return { stroke: 'var(--faint)', fill: 'var(--win)', strokeWidth: 2, strokeDasharray: '3 4' };
    default:
      return { stroke: 'var(--faint)', fill: 'var(--win)', strokeWidth: 2.5 };
  }
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export default function DevOpsLoop({ stages, statuses, progress }: DevOpsLoopProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const overlayRef = useRef<SVGPathElement>(null);
  const pulseRef = useRef<SVGGElement>(null);
  const lengthRef = useRef(0);
  const currentLenRef = useRef(0);
  const rafRef = useRef<number>();

  const [nodes, setNodes] = useState<NodePoint[]>([]);
  const [progressPct, setProgressPct] = useState(0);

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const L = path.getTotalLength();
    lengthRef.current = L;
    const count = stages.length;
    const pts: NodePoint[] = [];
    for (let k = 0; k < count; k++) {
      const len = ((k + 0.5) / count) * L;
      const pt = path.getPointAtLength(len);
      const above = pt.y < 200;
      pts.push({ x: pt.x, y: pt.y, lx: pt.x, ly: above ? pt.y - 28 : pt.y + 36 });
    }
    setNodes(pts);
    if (overlayRef.current) {
      overlayRef.current.style.strokeDasharray = String(L);
      overlayRef.current.style.strokeDashoffset = String(L);
    }
  }, [stages.length]);

  useEffect(() => {
    const L = lengthRef.current;
    if (!L) return;
    const start = currentLenRef.current;
    const target = (progress / 100) * L;
    const t0 = performance.now();
    const dur = 550;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const len = start + (target - start) * ease(p);
      currentLenRef.current = len;
      const pt = pathRef.current?.getPointAtLength(Math.max(0, Math.min(L, len)));
      if (pt && pulseRef.current) {
        pulseRef.current.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
        pulseRef.current.style.opacity = len > 0.5 ? '1' : '0';
      }
      if (overlayRef.current) overlayRef.current.style.strokeDashoffset = String(L - len);
      setProgressPct(Math.round((len / L) * 100));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [progress, nodes.length]);

  const failedIndex = stages.findIndex((s) => statuses[s.id] === 'failed');
  const breakNode = failedIndex >= 0 ? nodes[failedIndex] : null;

  return (
    <div>
      <div className="loop-legend" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span style={{ color: 'var(--t-cmd)', fontSize: 12, fontWeight: 600 }}>CI · Integration</span>
          <span style={{ color: 'var(--t-warn)', fontSize: 12, fontWeight: 600 }}>CD · Deployment</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="legend-item"><span className="legend-dot legend-dot--active" />active</span>
          <span className="legend-item"><span className="legend-dot legend-dot--ok" />passed</span>
          <span className="legend-item"><span className="legend-dot legend-dot--err" />failed</span>
        </div>
      </div>

      <svg viewBox="0 0 1000 400" style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
        <path ref={pathRef} d={LOOP_PATH} fill="none" stroke="var(--track)" strokeWidth={8} strokeLinecap="round" />
        <path ref={overlayRef} d={LOOP_PATH} fill="none" stroke="var(--accent)" strokeWidth={8} strokeLinecap="round" />
        <g>
          {nodes.map((node, i) => {
            const stage = stages[i];
            const type = stage.type || (stage.id === 'deploy' ? 'cd' : 'ci');
            const status = statuses[stage.id] ?? 'idle';
            const strong = status === 'active' || status === 'success' || status === 'failed';
            const cs = circleStyle(status);
            const nativeColor = type === 'cd' ? 'var(--t-warn)' : 'var(--t-cmd)';

            return (
              <g key={stage.id}>
                {status === 'active' && (
                  <circle cx={node.x} cy={node.y} r={16} fill="none" stroke="var(--accent)" strokeWidth={2} className="ring-pulse" />
                )}
                <circle cx={node.x} cy={node.y} r={15} style={cs} />
                <text x={node.x} y={node.y + 4} textAnchor="middle" style={{ fill: GLYPH_COLOR[status], fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: 13, fontWeight: 700 }}>
                  {GLYPH[status]}
                </text>
                <text
                  x={node.lx}
                  y={node.ly}
                  textAnchor="middle"
                  style={{
                    fill: strong ? 'var(--ink)' : nativeColor,
                    fontFamily: "-apple-system,'SF Pro Text',sans-serif",
                    fontSize: 12.5,
                    fontWeight: strong ? 600 : 500,
                    letterSpacing: '0.01em',
                  }}
                >
                  {stage.name}
                </text>
              </g>
            );
          })}
        </g>
        {breakNode && (
          <g>
            <line x1={breakNode.x - 9} y1={breakNode.y - 9} x2={breakNode.x + 9} y2={breakNode.y + 9} stroke="var(--err)" strokeWidth={5} strokeLinecap="round" />
            <line x1={breakNode.x + 9} y1={breakNode.y - 9} x2={breakNode.x - 9} y2={breakNode.y + 9} stroke="var(--err)" strokeWidth={5} strokeLinecap="round" />
          </g>
        )}
        <g ref={pulseRef} style={{ opacity: 0 }}>
          <circle r={15} fill="var(--accent)" opacity={0.16} />
          <circle r={6} fill="var(--accent)" stroke="var(--win)" strokeWidth={2} />
        </g>
      </svg>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '2px 0 12px' }}>
        <span style={{ fontFamily: "ui-monospace,'SF Mono',Menlo,monospace", fontSize: 11, color: 'var(--muted)' }}>
          progress&nbsp;·&nbsp;<span style={{ color: 'var(--ink)', fontWeight: 600 }}>{progressPct}%</span>
        </span>
      </div>
    </div>
  );
}
