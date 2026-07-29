import { useEffect, useRef, useState } from 'react';

interface ResumeData {
  user: string;
  uni: string;
  focus: string | string[];
  stack: string[];
  certs: string[];
  work: Array<{ role: string; company: string }>;
  links: {
    web: string;
    git: string;
    mail: string;
  };
}

interface AboutMeModalProps {
  onClose: () => void;
}

export default function AboutMeModal({ onClose }: AboutMeModalProps) {
  const [data, setData] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Movable / Draggable window state
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const initialPosRef = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).tagName === 'BUTTON' || (e.target as HTMLElement).classList.contains('tl')) {
      return;
    }
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    initialPosRef.current = { x: pos.x, y: pos.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPos({
      x: initialPosRef.current.x + dx,
      y: initialPosRef.current.y + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const fetchResume = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('https://api-terminal-resume.dhiadhiaaouina.workers.dev/api/resume');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchResume();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const focusStr = data ? (Array.isArray(data.focus) ? data.focus.join(' | ') : data.focus) : '';
  const stackStr = data ? (Array.isArray(data.stack) ? data.stack.join(' | ') : data.stack) : '';
  const certsStr = data ? (Array.isArray(data.certs) ? data.certs.join(' | ') : data.certs) : '';

  const webUrl = data ? (data.links.web.startsWith('http') ? data.links.web : 'https://' + data.links.web) : '';
  const gitUrl = data ? (data.links.git.startsWith('http') ? data.links.git : 'https://' + data.links.git) : '';
  const mailUrl = data ? 'mailto:' + data.links.mail : '';

  return (
    <div className="browser-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="window terminal-window"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '90%',
          maxWidth: '860px',
          background: 'rgba(15, 23, 42, 0.95)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '12px',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          transform: `translate(${pos.x}px, ${pos.y}px)`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out'
        }}
      >
        <div
          className="window-titlebar"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{
            background: 'rgba(30, 41, 59, 0.9)',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            cursor: 'move',
            userSelect: 'none'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="window-titlebar-dots">
              <span className="tl" style={{ background: '#ff5f57', cursor: 'pointer' }} onClick={onClose} title="Shut terminal" />
              <span className="tl" style={{ background: '#febc2e' }} />
              <span className="tl" style={{ background: '#28c840' }} />
            </div>
          </div>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
            dhia@lumosdhia: ~ (zsh) — About Me
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={fetchResume}
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.4)',
                padding: '2px 8px',
                borderRadius: '5px',
                fontSize: '0.75rem',
                fontFamily: 'inherit',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Re-fetch
            </button>
            <button
              onClick={onClose}
              title="Shut terminal"
              style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 16, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        </div>

        <div
          style={{
            padding: '24px',
            fontFamily: "'Fira Code', 'Courier New', monospace",
            fontSize: '0.95rem',
            lineHeight: 1.45,
            whiteSpace: 'pre',
            overflowX: 'auto',
            color: '#e2e8f0'
          }}
        >
          <div style={{ color: '#64748b', marginBottom: 16 }}>
            {"┌──("}<span style={{ color: '#38bdf8', fontWeight: 600 }}>dhia dynamic-node</span>{")-[~]\n"}
            {"└─$ "}<span style={{ color: '#f8fafc', fontWeight: 600 }}>fastfetch --profile resume</span>
          </div>

          {loading && <div style={{ color: '#94a3b8' }}>Fetching data from API...</div>}

          {error && <div style={{ color: '#ef4444' }}>Error loading data: {error}</div>}

          {data && (
            <div>
              <span style={{ color: '#38bdf8' }}>{"       .'_`\\            .'`\\"}</span>       <span style={{ color: '#4ade80', fontWeight: 700 }}>{data.user}</span>{"\n"}
              <span style={{ color: '#38bdf8' }}>{"      (_( \\ \\          (_( \\ \\"}</span>     <span style={{ color: '#64748b' }}>--------------</span>{"\n"}
              <span style={{ color: '#38bdf8' }}>{"           \\ \\              \\ \\"}</span>    <span style={{ color: '#ffffff', fontWeight: 700 }}>Uni:</span>      {data.uni}{"\n"}
              <span style={{ color: '#38bdf8' }}>{"            \\ \\ ____________\\ \\"}</span>    <span style={{ color: '#ffffff', fontWeight: 700 }}>Focus:</span>    <span style={{ color: '#38bdf8', fontWeight: 600 }}>{focusStr}</span>{"\n"}
              <span style={{ color: '#38bdf8' }}>{"             \\.'====. = .===='.\\"}</span>   <span style={{ color: '#ffffff', fontWeight: 700 }}>STACK:</span>    <span style={{ color: '#facc15', fontWeight: 600 }}>{stackStr}</span>{"\n"}
              <span style={{ color: '#38bdf8' }}>{"             ((      ) (      ))"}</span>   <span style={{ color: '#ffffff', fontWeight: 700 }}>CERTS:</span>    <span style={{ color: '#c084fc', fontWeight: 600 }}>{certsStr}</span>{"\n"}
              <span style={{ color: '#38bdf8' }}>{"              \\\\____// \\\\____//"}</span>    {"\n"}
              <span style={{ color: '#38bdf8' }}>{"               '----'   '----'"}</span>     <span style={{ color: '#ffffff', fontWeight: 700 }}>WORK</span>{"\n"}
              {data.work.map((w, idx) => {
                const prefix = idx === data.work.length - 1 ? '└──' : '├──';
                return (
                  <span key={idx}>
                    {`                                   ${prefix} ${w.role} @ `}
                    <span style={{ color: '#ffffff', fontWeight: 700 }}>{w.company}</span>
                    {"\n"}
                  </span>
                );
              })}
              {"\n"}
              {'                                   '}<span style={{ color: '#ffffff', fontWeight: 700 }}>LINKS</span>{"\n"}
              {'                                   ├── web:   '}<a href={webUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline', fontWeight: 600 }}>{data.links.web}</a>{"\n"}
              {'                                   ├── git:   '}<a href={gitUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', textDecoration: 'underline', fontWeight: 600 }}>{data.links.git}</a>{"\n"}
              {'                                   └── mail:  '}<a href={mailUrl} style={{ color: '#60a5fa', textDecoration: 'underline', fontWeight: 600 }}>{data.links.mail}</a>{"\n"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
