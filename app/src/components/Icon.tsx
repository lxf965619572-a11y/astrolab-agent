// 线性图标（1.7 描边，与设计稿一致），全部内联，不依赖图标字体或网络。

const P: Record<string, string> = {
  requirements: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  hld: 'M4 4h16v16H4zM4 10h16M10 10v10',
  dd: 'M6 3v18M6 7h8M6 12h6M6 17h10',
  coding: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  utest: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9',
  review: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5',
  skills: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  template: 'M4 4h16v6H4zM4 14h7v6H4zM15 14h5v6h-5z',
  settings: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2',
  home: 'M4 11l8-7 8 7v9a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  arrow: 'M4 12h12M10 6l6 6-6 6',
  send: 'M5 12h14M13 6l6 6-6 6',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  check: 'M5 12l4 4 10-10',
  warn: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  bulb: 'M12 3a6 6 0 0 0-4 10.5V17h8v-3.5A6 6 0 0 0 12 3zM9 21h6',
  terminal: 'M4 5h16v14H4zM8 10l3 2-3 2M13 15h4',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  chevron: 'M6 9l6 6 6-6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  branch: 'M6 4v12M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 8c0 6-12 4-12 8',
  volume: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 0 1 0 6',
  mute: 'M4 9h4l5-4v14l-5-4H4zM17 9l4 6M21 9l-4 6',
  sparkle: 'M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15.5l-1.8-4.7L5.5 9l4.7-1.3zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  wifiOff: 'M2 8.8a15 15 0 0 1 20 0M5.5 12.4a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 20h.01M3 3l18 18',
  palette: 'M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A4.7 4.7 0 0 0 22 9.7C21.6 5.9 17.3 3 12 3zM7.5 12.5h.01M9.5 8h.01M14.5 8h.01M17 11.5h.01',
  diagram: 'M3 5h7v5H3zM14 14h7v5h-7zM6.5 10v6.5H14M14 7.5h3.5V14',
  pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6',
  sidebar: 'M4 5h16v14H4zM9.5 5v14M6 9h1.5M6 12h1.5',
  chat: 'M4 5h16v11H10l-6 4z',
  newTask: 'M12 20h8M4 20h2l11-11a2.1 2.1 0 0 0-3-3L3 17v3z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M8 7h7M8 11h5',
  puzzle: 'M10 4h4v3a2 2 0 1 0 4 0V4h2v6h-3a2 2 0 1 0 0 4h3v6h-6v-3a2 2 0 1 0-4 0v3H4v-6h3a2 2 0 1 0 0-4H4V4z',
  upload: 'M12 16V4M7 9l5-5 5 5M5 20h14',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  stop: '',
  play: '',
}

export function Icon({ name, size = 16, stroke = 1.8, className, style }: { name: string; size?: number; stroke?: number; className?: string; style?: React.CSSProperties }) {
  if (name === 'stop') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} style={style}><rect x="7" y="7" width="10" height="10" rx="2" /></svg>
  if (name === 'play') return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} style={style}><path d="M8 5l11 7-11 7z" /></svg>
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>
      <path d={P[name] || P.file} />
    </svg>
  )
}

/** 应用图标“芯片轨道”：小尺寸简化版（标题栏、任务栏） */
// 图标颜色跟着皮肤走（tokens.css 的 --icon-*、--accent、--accent-text）
export function AppIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" role="img" aria-label="AstroLab">
      <defs>
        <linearGradient id="aiBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'var(--icon-bg-top)' }} /><stop offset="1" style={{ stopColor: 'var(--icon-bg)' }} /></linearGradient>
        <linearGradient id="aiChip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style={{ stopColor: 'var(--icon-chip-a)' }} /><stop offset="1" style={{ stopColor: 'var(--icon-chip-b)' }} /></linearGradient>
      </defs>
      <rect width="256" height="256" rx="58" fill="url(#aiBg)" />
      <rect x="4" y="4" width="248" height="248" rx="54" fill="none" style={{ stroke: 'var(--accent)' }} strokeOpacity=".45" strokeWidth="10" />
      <path d="M58 108h26M58 148h26M172 108h26M172 148h26M108 58v26M148 58v26M108 172v26M148 172v26" style={{ stroke: 'var(--icon-pin)' }} strokeWidth="18" strokeLinecap="round" />
      <rect x="80" y="80" width="96" height="96" rx="20" fill="url(#aiChip)" />
      <g transform="translate(128 128) rotate(-22)">
        <path d="M-104 0A104 38 0 0 0 104 0" fill="none" stroke="#FFFFFF" strokeWidth="30" strokeLinecap="round" />
        <path d="M-104 0A104 38 0 0 0 104 0" fill="none" style={{ stroke: 'var(--accent-text)' }} strokeWidth="18" strokeLinecap="round" />
        <circle cx="85.2" cy="21.8" r="22" style={{ fill: 'var(--accent-text)' }} stroke="#FFFFFF" strokeWidth="9" />
      </g>
    </svg>
  )
}

export const STAGE_ICON: Record<string, string> = {
  requirements: 'requirements', hld: 'hld', dd: 'dd', coding: 'coding', utest: 'utest', review: 'review',
}
