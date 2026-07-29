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
  idle: 'var(--muted)',
  active: '#38bdf8',
  success: '#22c55e',
  failed: '#ef4444',
  skipped: '#94a3b8',
};

const STAGE_TYPE_COLOR = {
  ci: '#38bdf8', // Cyan/Sky Blue for CI
  cd: '#c084fc', // Bright Purple/Magenta for CD
};

function circleStyle(status: StageStatus, type: 'ci' | 'cd') {
  const accentColor = STAGE_TYPE_COLOR[type];
  switch (status) {
    case 'active':
      return { stroke: accentColor, fill: 'rgba(56, 189, 248, 0.15)', strokeWidth: 3.5 };
    case 'success':
      return { stroke: '#22c55e', fill: 'rgba(34, 197, 94, 0.15)', strokeWidth: 3 };
    case 'failed':
      return { stroke: '#ef4444', fill: 'rgba(239, 68, 68, 0.2)', strokeWidth: 3 };
    case 'skipped':
      return { stroke: '#64748b', fill: 'rgba(15, 23, 42, 0.8)', strokeWidth: 2, strokeDasharray: '3 4' };
    default:
      return { stroke: accentColor, fill: 'rgba(15, 23, 42, 0.85)', strokeWidth: 2.5 };
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
      pts.push({
        x: pt.x,
        y: pt.y,
        lx: pt.x,
        ly: above ? pt.y - 32 : pt.y + 40,
      });
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
    <div style={{ padding: '4px 0 10px' }}>
      {/* Category Legend */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px 12px',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#38bdf8', boxShadow: '0 0 8px rgba(56, 189, 248, 0.6)' }} />
            CI (Continuous Integration)
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#c084fc' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#c084fc', boxShadow: '0 0 8px rgba(192, 132, 252, 0.6)' }} />
            CD (Continuous Deployment)
          </span>
        </div>

        <div className="loop-legend" style={{ margin: 0 }}>
          <span className="legend-item"><span className="legend-dot legend-dot--active" />active</span>
          <span className="legend-item"><span className="legend-dot legend-dot--ok" />passed</span>
          <span className="legend-item"><span className="legend-dot legend-dot--err" />failed</span>
        </div>
      </div>

      <svg viewBox="0 0 1000 400" style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(56, 189, 248, 0.4)" />
            <stop offset="70%" stopColor="rgba(56, 189, 248, 0.4)" />
            <stop offset="100%" stopColor="rgba(192, 132, 252, 0.5)" />
          </linearGradient>
        </defs>

        <path ref={pathRef} d={LOOP_PATH} fill="none" stroke="url(#trackGrad)" strokeWidth={7} strokeLinecap="round" opacity={0.6} />
        <path ref={overlayRef} d={LOOP_PATH} fill="none" stroke="#38bdf8" strokeWidth={7} strokeLinecap="round" />

        <g>
          {nodes.map((node, i) => {
            const stage = stages[i];
            const type = stage.type || (stage.id === 'deploy' ? 'cd' : 'ci');
            const status = statuses[stage.id] ?? 'idle';
            const labelColor = STAGE_TYPE_COLOR[type];
            const strong = status === 'active' || status === 'success' || status === 'failed';
            const cs = circleStyle(status, type);
            const nativeColor = type === 'cd' ? 'var(--t-warn)' : 'var(--t-cmd)';

            return (
              <g key={stage.id}>
                {status === 'active' && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={18}
                    fill="none"
                    stroke={labelColor}
                    strokeWidth={2}
                    className="ring-pulse"
                  />
                )}

                <circle cx={node.x} cy={node.y} r={15} style={cs} />

                {/* Status Glyph or Inner Dot */}
                {status === 'idle' || status === 'active' ? (
                  <circle cx={node.x} cy={node.y} r={4} fill={labelColor} />
                ) : (
                  <text
                    x={node.x}
                    y={node.y + 4}
                    textAnchor="middle"
                    style={{
                      fill: GLYPH_COLOR[status],
                      fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    {GLYPH[status]}
                  </text>
                )}

                {/* Stage Label Box & Text */}
                <g transform={`translate(${node.lx}, ${node.ly})`}>
                  <rect
                    x={-((stage.name.length * 7.5 + 24) / 2)}
                    y={-12}
                    width={stage.name.length * 7.5 + 24}
                    height={22}
                    rx={11}
                    fill="rgba(15, 23, 42, 0.85)"
                    stroke={labelColor}
                    strokeWidth={1}
                    style={{ backdropFilter: 'blur(4px)' }}
                  />
                  <text
                    x={0}
                    y={3}
                    textAnchor="middle"
                    style={{
                      fill: strong ? 'var(--ink)' : labelColor,
                      fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                    }}
                  >
                    {stage.name}
                  </text>
                </g>
              </g>
            );
          })}
        </g>

        {breakNode && (
          <g>
            <line x1={breakNode.x - 9} y1={breakNode.y - 9} x2={breakNode.x + 9} y2={breakNode.y + 9} stroke="#ef4444" strokeWidth={5} strokeLinecap="round" />
            <line x1={breakNode.x + 9} y1={breakNode.y - 9} x2={breakNode.x - 9} y2={breakNode.y + 9} stroke="#ef4444" strokeWidth={5} strokeLinecap="round" />
          </g>
        )}

        <g ref={pulseRef} style={{ opacity: 0 }}>
          <circle r={15} fill="#38bdf8" opacity={0.3} />
          <circle r={6} fill="#38bdf8" stroke="#ffffff" strokeWidth={2} />
        </g>
      </svg>

      <div style={{ display: 'flex', justifyContent: 'center', padding: '6px 0 2px' }}>
        <span style={{ fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace", fontSize: 11.5, color: '#94a3b8' }}>
          progress&nbsp;·&nbsp;<span style={{ color: '#38bdf8', fontWeight: 700 }}>{progressPct}%</span>
        </span>
      </div>
    </div>
  );
}
