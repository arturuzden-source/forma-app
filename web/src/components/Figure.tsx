import { POSES, type P, type Pose, type Prop } from '../poses';

const INK = 'var(--ink)';
const FAR = 'var(--ink-faint)';

function line(a: P, b: P, color: string, w: number, key: string) {
  return <line key={key} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={w} strokeLinecap="round" />;
}

function prop(p: Prop, i: number) {
  switch (p.t) {
    case 'line':
      return <line key={i} x1={p.a[0]} y1={p.a[1]} x2={p.b[0]} y2={p.b[1]} stroke="var(--line-strong)" strokeWidth={p.w ?? 2} strokeLinecap="round" />;
    case 'rect':
      return <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={2} fill="var(--surface-raised)" stroke="var(--line-strong)" strokeWidth={1.5} />;
    case 'db':
      return (
        <g key={i} fill="var(--ink-muted)">
          <rect x={p.at[0] - 7} y={p.at[1] - 3} width={14} height={6} rx={2} />
          <rect x={p.at[0] - 9} y={p.at[1] - 5} width={4} height={10} rx={1} />
          <rect x={p.at[0] + 5} y={p.at[1] - 5} width={4} height={10} rx={1} />
        </g>
      );
    case 'plate':
      return (
        <g key={i}>
          <line x1={p.at[0] - 22} y1={p.at[1]} x2={p.at[0] + 22} y2={p.at[1]} stroke="var(--ink-muted)" strokeWidth={3} />
          <circle cx={p.at[0] - 18} cy={p.at[1]} r={7} fill="var(--ink-muted)" />
        </g>
      );
    case 'arrow': {
      const [x1, y1] = p.a;
      const [x2, y2] = p.b;
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const h = 6;
      const l: P = [x2 - h * Math.cos(ang - 0.5), y2 - h * Math.sin(ang - 0.5)];
      const r: P = [x2 - h * Math.cos(ang + 0.5), y2 - h * Math.sin(ang + 0.5)];
      return (
        <g key={i} stroke="var(--accent)" strokeWidth={2.5} strokeLinecap="round" fill="none">
          <line x1={x1} y1={y1} x2={x2} y2={y2} />
          <polyline points={`${l[0]},${l[1]} ${x2},${y2} ${r[0]},${r[1]}`} />
        </g>
      );
    }
  }
}

/** Схема позы упражнения. Рисуется кодом, поэтому не может «не загрузиться». */
export function PoseFigure({ pose, size = 120, label }: { pose: string; size?: number; label: string }) {
  const p: Pose | undefined = POSES[pose];
  if (!p) return <div className="pose-missing">{label}</div>;
  const torso = p.spine ? (
    <path d={`M${p.neck[0]} ${p.neck[1]} Q${p.spine[0]} ${p.spine[1]} ${p.hip[0]} ${p.hip[1]}`} stroke={INK} strokeWidth={4.5} fill="none" strokeLinecap="round" />
  ) : (
    line(p.neck, p.hip, INK, 4.5, 'torso')
  );
  return (
    <svg viewBox="0 0 120 140" width={size} height={(size * 140) / 120} role="img" aria-label={label}>
      {!p.noGround && <line x1={6} y1={131} x2={114} y2={131} stroke="var(--line-strong)" strokeWidth={1.5} />}
      {(p.props ?? []).filter((x) => x.t !== 'arrow' && x.t !== 'db' && x.t !== 'plate').map(prop)}
      {line(p.hip, p.k2, FAR, 4, 'k2')}
      {line(p.k2, p.f2, FAR, 4, 'f2')}
      {line(p.neck, p.e2, FAR, 3.5, 'e2')}
      {line(p.e2, p.h2, FAR, 3.5, 'h2')}
      {torso}
      {line(p.hip, p.k1, INK, 4, 'k1')}
      {line(p.k1, p.f1, INK, 4, 'f1')}
      {line(p.neck, p.e1, INK, 3.5, 'e1')}
      {line(p.e1, p.h1, INK, 3.5, 'h1')}
      <circle cx={p.head[0]} cy={p.head[1]} r={8} fill="var(--bg)" stroke={INK} strokeWidth={3.5} />
      {(p.props ?? []).filter((x) => x.t === 'arrow' || x.t === 'db' || x.t === 'plate').map(prop)}
    </svg>
  );
}

/** Аватар: 2 персонажа × 3 телосложения. Иллюстрация, а не измерение тела. */
export function AvatarFigure({ sex, build, width = 112, shirt = '#5b636e' }: { sex: 'm' | 'f'; build: number; width?: number; shirt?: string }) {
  const B = [
    { sh: 22, w: 15, arm: 8, leg: 11 },
    { sh: 27, w: 19, arm: 10, leg: 13 },
    { sh: 33, w: 25, arm: 12, leg: 16 }
  ][Math.min(2, Math.max(0, build - 1))]!;
  const sh = sex === 'f' ? B.sh - 3 : B.sh;
  const w = sex === 'f' ? B.w - 2 : B.w;
  const hip = sex === 'f' ? B.w + 4 : B.w + 1;
  const lx = 60 - hip / 2 - 1;
  const rx = 60 + hip / 2 + 1;
  const skin = '#c99a7c';
  const hair =
    sex === 'f'
      ? 'M44 36 Q43 14 60 14 Q77 14 76 36 L78 60 Q71 56 71 40 Q68 24 60 24 Q52 24 49 40 Q49 56 42 60 Z'
      : 'M45 31 Q45 15 60 15 Q75 15 75 31 Q70 23 60 23 Q50 23 45 31 Z';
  return (
    <svg viewBox="0 0 120 200" width={width} height={(width * 200) / 120} aria-hidden="true">
      <path d={`M${lx} 144 L${lx - 2} 190`} stroke={skin} strokeWidth={B.leg} strokeLinecap="round" />
      <path d={`M${rx} 144 L${rx + 2} 190`} stroke={skin} strokeWidth={B.leg} strokeLinecap="round" />
      <path d={`M${60 - w} 118 L${60 + w} 118 L${60 + hip} 148 L63 148 L60 138 L57 148 L${60 - hip} 148 Z`} fill="#3a4049" />
      <path d={`M${60 - sh + 5} 66 L${60 - sh - 5} 124`} stroke={skin} strokeWidth={B.arm} strokeLinecap="round" />
      <path d={`M${60 + sh - 5} 66 L${60 + sh + 5} 124`} stroke={skin} strokeWidth={B.arm} strokeLinecap="round" />
      <rect x={54} y={44} width={12} height={16} rx={5} fill={skin} />
      <path d={`M${60 - sh} 68 Q${60 - sh} 58 ${60 - sh + 10} 58 L${60 + sh - 10} 58 Q${60 + sh} 58 ${60 + sh} 68 L${60 + w} 122 L${60 - w} 122 Z`} fill={shirt} />
      <circle cx={60} cy={33} r={15} fill={skin} />
      <path d={hair} fill="#6b4f3a" />
    </svg>
  );
}
