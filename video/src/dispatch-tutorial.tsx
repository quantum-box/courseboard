import {Audio} from '@remotion/media';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import type {CSSProperties, ReactElement, ReactNode} from 'react';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {FONT} from './font';
import narration from './narration-dispatch.json';

/**
 * キャディの配置の使い方動画。
 *
 * 見せているのは desktop のキャディの配置画面（`desktop/src/features/golf/
 * CaddiesPage.tsx` の dispatch タブと `UnassignedRounds.tsx`）で、文言は
 * 日本語 locale の `caddies.dispatch.* / autoAssign.* / unassigned.* / reassign.* /
 * supply.*` に合わせてある。画面は実物の写しではなく再現なので、UI を変えたときは
 * ここも直す。
 *
 * 組名・キャディ名・数値はすべて架空のデモ値で、実在の顧客・従業員は含まない。
 * 部品（Stage / Cursor / Ring / MockPanel …）は `reception-tutorial.tsx` の写し。
 */

const T = {
  ink: '#252b28',
  turf: '#286f5a',
  turfDark: '#1d5544',
  turfSoft: '#e8f2ee',
  sand: '#b88942',
  sandSoft: '#fbf1de',
  danger: '#b64740',
  dangerSoft: '#fbecea',
  muted: '#6d7a74',
  faint: '#96a19b',
  line: '#e2e7e4',
  surface: '#ffffff',
  canvas: '#eef1ef',
  /** 動画の注釈だけに使う赤。画面の色（緑・砂）と混ざらないよう UI では使わない。 */
  guide: '#e23b2e',
} as const;

const CLAMP = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};
const EASE = {...CLAMP, easing: Easing.inOut(Easing.ease)};

/** 画面モックの内側。カーソル座標はすべて動画全体（1920×1080）の絶対座標で書く。 */
const WINDOW = {left: 120, top: 104, width: 1680, height: 780} as const;
const CONTENT = {left: 356, top: 178, width: 1416, height: 678} as const;

/**
 * 配置画面の縦の割り付け。上から、表示の切り替え・当日の稼働サマリー・節の見出し・
 * 本体。カーソルと強調枠の座標はここから引いているので、高さを変えたら座標も引き直す。
 */
const L = {
  tabsTop: CONTENT.top,
  tabsH: 44,
  barTop: CONTENT.top + 44 + 14,
  barH: 46,
  sectionTop: CONTENT.top + 44 + 14 + 46 + 16,
  sectionH: 50,
  gridTop: CONTENT.top + 44 + 14 + 46 + 16 + 50 + 12,
  gridH: 678 - (44 + 14 + 46 + 16 + 50 + 12),
  leftW: 1044,
  rightX: CONTENT.left + 1044 + 20,
  rightW: 352,
  pad: 22,
} as const;

// ── ナレーション ────────────────────────────────────────────────────────────

const FPS = 30;
/** 音声が鳴り出すまでの間。ちょうど直前のトランジションが終わる長さ。 */
const LEAD = 12;
/** 言い終わってから次のシーンへ移るまでの間。 */
const TAIL = 18;

type NarrationId = keyof typeof narration.clips;

const speechFrames = (id: NarrationId) =>
  Math.round(narration.clips[id].seconds * FPS);

const sceneFrames = (id: NarrationId) => speechFrames(id) + LEAD + TAIL;

/** 画面の動きをナレーションの進み具合（0〜1）で置く。 */
const cue = (speech: number, ratio: number) => LEAD + Math.round(speech * ratio);

type SceneProps = {speech: number};

const Narration = ({id}: {id: NarrationId}) => (
  <Sequence from={LEAD}>
    <Audio src={staticFile(`audio/dispatch/${id}.wav`)} />
  </Sequence>
);

// ── 小さな部品 ──────────────────────────────────────────────────────────────

const useEnter = (delay = 0, duration = 12) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return spring({
    frame: frame - delay,
    fps,
    durationInFrames: duration,
    config: {damping: 20, stiffness: 200},
  });
};

const Pop = ({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: CSSProperties;
}) => {
  const p = useEnter(delay);
  return (
    <div
      style={{
        ...style,
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [14, 0])}px)`,
      }}
    >
      {children}
    </div>
  );
};

const Logo = ({light = false, width = 168}: {light?: boolean; width?: number}) => (
  <Img
    src={staticFile(
      light
        ? 'brand/courseboard-horizontal-reversed-transparent.png'
        : 'brand/courseboard-horizontal-primary-transparent.png',
    )}
    style={{width, height: width * 0.43, objectFit: 'contain'}}
  />
);

const PointerIcon = () => (
  <svg width={38} height={44} viewBox="0 0 24 28" style={{display: 'block'}}>
    <path
      d="M3 1.6 3 21.2 8.2 16.4 11.6 24.6 15.4 23 12 15 19 14.4Z"
      fill="#ffffff"
      stroke="#1b241f"
      strokeWidth={1.6}
      strokeLinejoin="round"
    />
  </svg>
);

type Stop = {at: number; x: number; y: number};
type Click = {at: number; x: number; y: number};

const Ripple = ({click}: {click: Click}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [click.at, click.at + 18], [0, 1], CLAMP);
  if (p <= 0 || p >= 1) return null;
  const size = interpolate(p, [0, 1], [8, 96]);
  return (
    <div
      style={{
        position: 'absolute',
        left: click.x - size / 2,
        top: click.y - size / 2,
        width: size,
        height: size,
        borderRadius: '50%',
        border: `4px solid ${T.guide}`,
        opacity: 1 - p,
      }}
    />
  );
};

const Cursor = ({stops, clicks = []}: {stops: readonly Stop[]; clicks?: readonly Click[]}) => {
  const frame = useCurrentFrame();
  const ats = stops.map((s) => s.at);
  const x = interpolate(frame, ats, stops.map((s) => s.x), EASE);
  const y = interpolate(frame, ats, stops.map((s) => s.y), EASE);
  const appear = interpolate(frame, [ats[0] - 8, ats[0]], [0, 1], CLAMP);
  const press = clicks.reduce(
    (acc, c) => Math.max(acc, interpolate(frame, [c.at - 2, c.at + 1, c.at + 7], [0, 1, 0], CLAMP)),
    0,
  );
  return (
    <AbsoluteFill>
      {clicks.map((c) => (
        <Ripple key={c.at} click={c} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: x,
          top: y,
          opacity: appear,
          transform: `scale(${1 - press * 0.18})`,
          transformOrigin: '2px 2px',
          filter: 'drop-shadow(0 4px 8px rgba(15,30,24,.35))',
        }}
      >
        <PointerIcon />
      </div>
    </AbsoluteFill>
  );
};

/** 囲みを対象の外側に出す余白。 */
const RING_PAD = 7;

/** 注目させたい範囲を囲む枠。from〜to のあいだだけ出る。対象の矩形をそのまま渡す。 */
const Ring = ({
  x,
  y,
  width,
  height,
  from,
  to,
  tone = T.guide,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  from: number;
  to: number;
  tone?: string;
}) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [from, from + 8, to - 8, to], [0, 1, 1, 0], CLAMP);
  if (o <= 0) return null;
  const pulse = 1 + Math.sin((frame - from) / 7) * 0.012;
  const PAD = RING_PAD;
  return (
    <div
      style={{
        position: 'absolute',
        left: x - PAD,
        top: y - PAD,
        width: width + PAD * 2,
        height: height + PAD * 2,
        borderRadius: 14,
        border: `4px solid ${tone}`,
        boxShadow: `0 0 0 5px ${tone}33, 0 0 22px ${tone}55`,
        opacity: o,
        transform: `scale(${pulse})`,
      }}
    />
  );
};

// ── アプリ画面の枠 ──────────────────────────────────────────────────────────

const SIDEBAR = [
  'ホーム',
  '予約',
  '顧客台帳',
  'キャディ',
  'シフト',
  'コース',
  '精算',
  '設定',
] as const;

const AppWindow = ({breadcrumb, children}: {breadcrumb: string; children: ReactNode}) => (
  <div
    style={{
      position: 'absolute',
      ...WINDOW,
      background: T.surface,
      borderRadius: 16,
      border: `1px solid ${T.line}`,
      boxShadow: '0 26px 60px rgba(20,40,32,.16)',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}
  >
    <div
      style={{
        height: 46,
        flexShrink: 0,
        borderBottom: `1px solid ${T.line}`,
        background: '#f7f9f8',
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        gap: 8,
      }}
    >
      {['#e0655c', '#e2b04a', '#54b07a'].map((c) => (
        <span key={c} style={{width: 11, height: 11, borderRadius: '50%', background: c}} />
      ))}
      <div style={{marginLeft: 18, fontSize: 15, color: T.faint}}>{breadcrumb}</div>
    </div>
    <div style={{display: 'flex', flex: 1, minHeight: 0}}>
      <div
        style={{
          width: 208,
          flexShrink: 0,
          borderRight: `1px solid ${T.line}`,
          background: '#f7f9f8',
          padding: '16px 12px',
        }}
      >
        {SIDEBAR.map((item) => {
          const active = item === 'キャディ';
          return (
            <div
              key={item}
              style={{
                padding: '11px 14px',
                borderRadius: 8,
                fontSize: 16,
                fontWeight: active ? 800 : 500,
                color: active ? T.turfDark : T.muted,
                background: active ? T.turfSoft : 'transparent',
                marginBottom: 2,
              }}
            >
              {item}
            </div>
          );
        })}
      </div>
      <div style={{flex: 1, minWidth: 0, padding: 28, background: '#fcfdfc'}}>{children}</div>
    </div>
  </div>
);

const BREADCRUMB = 'CourseBoard ／ キャディ ／ キャディの配置';

const Stage = ({
  step,
  label,
  caption,
  narration,
  overlay,
  children,
}: {
  step?: number;
  label: string;
  caption: ReactNode;
  /** このシーンで流す読み上げ。 */
  narration?: ReactNode;
  /** カーソル・強調枠・シート。動画全体（1920×1080）の座標で置けるよう窓の外に出す。 */
  overlay?: ReactNode;
  children: ReactNode;
}) => (
  <AbsoluteFill style={{background: T.canvas, fontFamily: FONT, color: T.ink}}>
    {narration}
    <div
      style={{
        position: 'absolute',
        left: 120,
        right: 120,
        top: 0,
        height: 104,
        display: 'flex',
        alignItems: 'center',
        gap: 20,
      }}
    >
      <Logo />
      <div style={{width: 1, height: 28, background: '#c9d3ce'}} />
      <div style={{fontSize: 21, color: T.muted}}>その日のキャディ配置を決める</div>
      <div style={{marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16}}>
        {step ? (
          <span
            style={{
              padding: '8px 16px',
              borderRadius: 99,
              background: T.turf,
              color: '#fff',
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: '.06em',
            }}
          >
            STEP {step} / 5
          </span>
        ) : null}
        <span style={{fontSize: 24, fontWeight: 800}}>{label}</span>
      </div>
    </div>

    <AppWindow breadcrumb={BREADCRUMB}>{children}</AppWindow>
    {overlay}

    <div
      style={{
        position: 'absolute',
        left: 120,
        top: 908,
        width: 1680,
        minHeight: 116,
        borderRadius: 14,
        background: T.turfDark,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        padding: '0 32px',
        boxSizing: 'border-box',
      }}
    >
      <span style={{width: 6, height: 56, borderRadius: 3, background: '#b8e55d', flexShrink: 0}} />
      <div style={{fontSize: 30, lineHeight: 1.4, fontWeight: 700}}>{caption}</div>
    </div>
  </AbsoluteFill>
);

// ── アプリの部品モック ──────────────────────────────────────────────────────

const MockPanel = ({
  title,
  description,
  /** 説明の行数。座標を予測できるよう高さを固定する。 */
  descriptionLines = 1,
  actions,
  children,
  style,
}: {
  title?: string;
  description?: string;
  descriptionLines?: number;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}) => (
  <div
    style={{
      background: T.surface,
      border: `1px solid ${T.line}`,
      borderRadius: 12,
      padding: L.pad,
      boxSizing: 'border-box',
      ...style,
    }}
  >
    {title || actions ? (
      <div style={{display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 16}}>
        <div style={{flex: 1, minWidth: 0}}>
          {title ? <div style={{fontSize: 22, fontWeight: 800, lineHeight: '30px'}}>{title}</div> : null}
          {description ? (
            <div
              style={{
                fontSize: 16,
                color: T.muted,
                marginTop: 6,
                lineHeight: '24px',
                height: 24 * descriptionLines,
              }}
            >
              {description}
            </div>
          ) : null}
        </div>
        {actions ? <div style={{display: 'flex', gap: 10, flexShrink: 0}}>{actions}</div> : null}
      </div>
    ) : null}
    {children}
  </div>
);

const Btn = ({
  label,
  variant = 'secondary',
  disabled = false,
  size = 'md',
  tone,
  style,
}: {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  size?: 'md' | 'sm';
  tone?: 'danger';
  style?: CSSProperties;
}) => {
  const skin =
    variant === 'primary'
      ? {background: T.turf, color: '#fff', border: `1px solid ${T.turf}`}
      : variant === 'ghost'
        ? {background: 'transparent', color: tone === 'danger' ? T.danger : T.muted, border: '1px solid transparent'}
        : {background: '#fff', color: T.ink, border: `1px solid ${T.line}`};
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: size === 'sm' ? '0 14px' : '0 18px',
        height: size === 'sm' ? 36 : 42,
        borderRadius: 9,
        fontSize: size === 'sm' ? 15 : 17,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        opacity: disabled ? 0.42 : 1,
        ...skin,
        ...style,
      }}
    >
      {label}
    </div>
  );
};

const Notice = ({
  tone,
  title,
  children,
  style,
}: {
  tone: 'warning' | 'danger' | 'info';
  title?: string;
  children?: ReactNode;
  style?: CSSProperties;
}) => {
  const skin =
    tone === 'danger'
      ? {background: T.dangerSoft, border: `1px solid ${T.danger}55`, color: '#8a352f'}
      : tone === 'warning'
        ? {background: T.sandSoft, border: `1px solid ${T.sand}66`, color: '#845e22'}
        : {background: T.turfSoft, border: `1px solid ${T.turf}44`, color: T.turfDark};
  return (
    <div
      style={{
        borderRadius: 10,
        padding: '11px 14px',
        fontSize: 15,
        lineHeight: 1.45,
        boxSizing: 'border-box',
        ...skin,
        ...style,
      }}
    >
      {title ? <div style={{fontWeight: 800, fontSize: 16}}>{title}</div> : null}
      {children}
    </div>
  );
};

const Badge = ({
  label,
  variant = 'neutral',
}: {
  label: string;
  variant?: 'neutral' | 'accent' | 'success' | 'warning';
}) => {
  const skin =
    variant === 'accent'
      ? {background: T.sandSoft, color: '#845e22'}
      : variant === 'success'
        ? {background: T.turfSoft, color: T.turfDark}
        : variant === 'warning'
          ? {background: T.sandSoft, color: '#845e22'}
          : {background: '#f0f3f1', color: T.muted};
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 99,
        fontSize: 14,
        fontWeight: 800,
        whiteSpace: 'nowrap',
        ...skin,
      }}
    >
      {label}
    </span>
  );
};

/** 「ラウンド配置 ／ 別業務」の表示の切り替え。 */
const DispatchTabs = () => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 4,
      width: 420,
      height: L.tabsH,
      padding: 4,
      boxSizing: 'border-box',
      borderRadius: 10,
      border: `1px solid ${T.line}`,
      background: '#fff',
    }}
  >
    {['ラウンド配置', '別業務'].map((label, i) => (
      <div
        key={label}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          fontSize: 16,
          fontWeight: 800,
          color: i === 0 ? T.turfDark : T.muted,
          background: i === 0 ? T.turfSoft : 'transparent',
        }}
      >
        {label}
      </div>
    ))}
  </div>
);

/** 対象の日と、当日の稼働サマリー。 */
const SummaryBar = ({
  date,
  unassigned,
  assigned,
  focused = false,
}: {
  date: string;
  unassigned: number;
  assigned: number;
  focused?: boolean;
}) => (
  <div
    style={{
      marginTop: 14,
      height: L.barH,
      boxSizing: 'border-box',
      borderTop: `1px solid ${T.line}`,
      borderBottom: `1px solid ${T.line}`,
      display: 'flex',
      alignItems: 'center',
      gap: 16,
    }}
  >
    <div
      style={{
        width: 170,
        height: 36,
        boxSizing: 'border-box',
        borderRadius: 8,
        border: `1px solid ${focused ? T.turf : T.line}`,
        boxShadow: focused ? `0 0 0 3px ${T.turf}22` : 'none',
        background: '#fff',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        fontSize: 17,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {date}
    </div>
    {[
      ['未配置', `${unassigned}組`],
      ['配置済み', `${assigned}組`],
      ['別業務', '0人'],
      ['空きあり', `${6 - assigned}人`],
    ].map(([label, value]) => (
      <span key={label} style={{fontSize: 16, color: T.muted, whiteSpace: 'nowrap'}}>
        {label}
        <strong style={{marginLeft: 6, color: T.ink, fontWeight: 800}}>{value}</strong>
      </span>
    ))}
  </div>
);

const SectionTitle = ({title, description, chevron = false}: {title: string; description: string; chevron?: boolean}) => (
  <div style={{marginTop: 16, height: L.sectionH, boxSizing: 'border-box'}}>
    <div style={{fontSize: 20, fontWeight: 800, lineHeight: '28px', display: 'flex', alignItems: 'center', gap: 10}}>
      {chevron ? <span style={{fontSize: 16, color: T.muted}}>▾</span> : null}
      {title}
    </div>
    <div style={{fontSize: 15, color: T.muted, lineHeight: '22px'}}>{description}</div>
  </div>
);

// ── デモデータ ──────────────────────────────────────────────────────────────

/** 架空の組。organizer 名は「様」付きの姓だけにして、実在の顧客と重ならないようにする。 */
const GROUPS = [
  {time: '08:04', party: '山田様', course: '東コース', players: 4, caddie: '佐々木 恵'},
  {time: '08:12', party: '鈴木様', course: '東コース', players: 3, caddie: '中村 由紀'},
  {time: '08:20', party: '田中様', course: '西コース', players: 4, caddie: '小林 大輔'},
  {time: '08:28', party: '高橋様', course: '東コース', players: 2, caddie: '高橋 みどり'},
] as const;

const DATE_TODAY = '2026/09/02';
const DATE_TARGET = '2026/09/05';

/** 「キャディが決まっていない組」の行。i 行目の中心 y は UNASSIGNED_ROW_Y(i)。 */
const UNASSIGNED_ROW_H = 64;
const UNASSIGNED_ROW_GAP = 8;
const UNASSIGNED_ROWS_TOP = L.gridTop + L.pad + 30 + 6 + 24 + 16;
const UNASSIGNED_ROW_Y = (i: number) =>
  UNASSIGNED_ROWS_TOP + i * (UNASSIGNED_ROW_H + UNASSIGNED_ROW_GAP) + UNASSIGNED_ROW_H / 2;
/** 行末の「キャディを決める」。 */
const NAME_BTN = {width: 148, x: CONTENT.left + L.leftW - L.pad - 148} as const;

const UnassignedPanel = ({
  rows,
  flash,
}: {
  rows: readonly (typeof GROUPS)[number][];
  flash?: ReactNode;
}) => (
  <MockPanel
    title="キャディが決まっていない組"
    description="キャディ付きで受けた予約のうち、まだ担当がいない組です。自動配置で埋まらなかった分はここから決めます。"
    style={{height: '100%'}}
  >
    {flash}
    {rows.length === 0 && !flash ? (
      <div style={{textAlign: 'center', padding: '60px 0'}}>
        <div style={{fontSize: 22, fontWeight: 800}}>すべての組に担当がいます</div>
        <div style={{fontSize: 16, color: T.muted, marginTop: 10}}>
          この日のキャディ付きの予約は、すべて担当が決まっています。
        </div>
      </div>
    ) : null}
    {rows.map((g) => (
      <div
        key={g.time}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          height: UNASSIGNED_ROW_H,
          boxSizing: 'border-box',
          padding: '0 14px',
          marginBottom: UNASSIGNED_ROW_GAP,
          border: `1px solid ${T.line}`,
          borderRadius: 10,
          background: '#fff',
        }}
      >
        <span style={{fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums', width: 60}}>
          {g.time}
        </span>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 18, fontWeight: 700, lineHeight: '22px'}}>{g.party}</div>
          <div style={{fontSize: 14, color: T.muted, lineHeight: '18px'}}>
            {g.course} · {g.players}名
          </div>
        </div>
        <Btn label="キャディを決める" size="sm" style={{width: NAME_BTN.width}} />
      </div>
    ))}
  </MockPanel>
);

/** 「自動で配置する」パネル。2つのボタンの中心座標を外に出しておく。 */
const AUTO_BTN_X = L.rightX + L.pad;
const AUTO_BTN_W = L.rightW - L.pad * 2;
const AUTO_HEADER_BOTTOM = L.gridTop + L.pad + 30 + 6 + 48 + 16;
const AUTO_PREVIEW = {x: AUTO_BTN_X, y: AUTO_HEADER_BOTTOM, w: AUTO_BTN_W, h: 42} as const;
const AUTO_EXECUTE = {x: AUTO_BTN_X, y: AUTO_HEADER_BOTTOM + 42 + 10, w: AUTO_BTN_W, h: 42} as const;

const PLAN = [
  {caddie: '佐々木 恵', when: '9月5日 08:04', why: '出勤ずみ · 評価の平均 4.6'},
  {caddie: '中村 由紀', when: '9月5日 08:12', why: '出勤ずみ · 評価の平均 4.3'},
  {caddie: '小林 大輔', when: '9月5日 08:20', why: '4人組にはベテランが向きます'},
] as const;

const AutoAssignPanel = ({
  busy,
  plan,
  done,
}: {
  busy?: 'preview' | 'execute';
  plan?: boolean;
  done?: boolean;
}) => (
  <MockPanel
    title="自動で配置する"
    description="まだ決まっていないキャディ付きの予約に、出勤とスキルから候補を当てます。"
    descriptionLines={2}
    style={{height: '100%'}}
  >
    <Btn
      label={busy === 'preview' ? '計算中…' : '配置を試す'}
      style={{width: '100%'}}
      disabled={busy !== undefined}
    />
    <Btn
      label={busy === 'execute' ? '決めています…' : 'この配置で決める'}
      variant="primary"
      style={{width: '100%', marginTop: 10}}
      disabled={busy !== undefined || !plan}
    />
    {done ? (
      <Notice tone="info" title="自動の配置を決めました" style={{marginTop: 14}}>
        3件を割り当て、1件は飛ばしました。
      </Notice>
    ) : plan ? (
      <div style={{marginTop: 14}}>
        {PLAN.map((p) => (
          <div
            key={p.caddie}
            style={{
              border: `1px solid ${T.line}`,
              borderRadius: 10,
              padding: '8px 12px',
              marginBottom: 6,
              background: '#fff',
              height: 52,
              boxSizing: 'border-box',
            }}
          >
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
              <span style={{fontSize: 16, fontWeight: 800}}>{p.caddie}</span>
              <Badge label="候補" variant="accent" />
            </div>
            <div style={{fontSize: 13, color: T.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden'}}>
              {p.when} · {p.why}
            </div>
          </div>
        ))}
        <Notice tone="warning" title="1件を飛ばしました" style={{marginTop: 8, fontSize: 14}}>
          空いているキャディがいません
        </Notice>
      </div>
    ) : null}
  </MockPanel>
);

/** ラウンド配置タブの本体（切り替え・サマリー・未配置の節）。 */
const DispatchBody = ({
  date,
  unassigned,
  assigned,
  dateFocused,
  rows,
  flash,
  auto,
}: {
  date: string;
  unassigned: number;
  assigned: number;
  dateFocused?: boolean;
  rows: readonly (typeof GROUPS)[number][];
  flash?: ReactNode;
  auto: ReactNode;
}) => (
  <>
    <DispatchTabs />
    <SummaryBar date={date} unassigned={unassigned} assigned={assigned} focused={dateFocused} />
    <SectionTitle
      title="未配置を解消する"
      description="未配置の組を確認し、まとめて割り当てるか、1組ずつ担当を決めます。"
    />
    <div
      style={{
        marginTop: 12,
        height: L.gridH,
        display: 'grid',
        gridTemplateColumns: `${L.leftW}px ${L.rightW}px`,
        gap: 20,
      }}
    >
      <UnassignedPanel rows={rows} flash={flash} />
      {auto}
    </div>
  </>
);

// ── 各シーン ────────────────────────────────────────────────────────────────

const TitleScene = () => (
  <AbsoluteFill
    style={{
      fontFamily: FONT,
      background: `linear-gradient(135deg, ${T.turfDark}, #0d2a22)`,
      color: '#fff',
      padding: 110,
      justifyContent: 'center',
    }}
  >
    <Narration id="title" />
    <Logo light width={230} />
    <div style={{marginTop: 56, fontSize: 26, color: '#b8e55d', letterSpacing: '.16em', fontWeight: 800}}>
      つかいかた
    </div>
    <div style={{marginTop: 20, fontSize: 84, lineHeight: 1.2, fontWeight: 850, letterSpacing: '-.04em'}}>
      その日のキャディ配置を、
      <br />
      決める
    </div>
    <div style={{marginTop: 30, fontSize: 30, color: '#cfe2da', lineHeight: 1.6}}>
      自動で試して決め、残った組を1組ずつ埋め、あとから直すまで。
    </div>
    <div style={{marginTop: 40, display: 'flex', gap: 14}}>
      {['5ステップ', '約1分40秒', 'キャディ › キャディの配置'].map((chip) => (
        <span
          key={chip}
          style={{
            padding: '11px 22px',
            borderRadius: 99,
            border: '1px solid #4a7d6b',
            color: '#d9ece3',
            fontSize: 22,
          }}
        >
          {chip}
        </span>
      ))}
    </div>
  </AbsoluteFill>
);

const STEPS = [
  ['1', '日付をえらぶ', '当日でも、先の日でも'],
  ['2', '自動で試す', '「配置を試す」は候補を出すだけ'],
  ['3', 'この配置で決める', '割り当てた件数と飛ばした件数が出る'],
  ['4', '残りを1組ずつ', '「キャディを決める」から候補をえらぶ'],
  ['5', '割当を直す', '付け替え・完了・取り消し'],
] as const;

const OverviewScene = ({speech}: SceneProps) => (
  <AbsoluteFill style={{fontFamily: FONT, background: T.canvas, color: T.ink, padding: '92px 110px'}}>
    <Narration id="overview" />
    <Pop>
      <div style={{fontSize: 24, color: T.turf, fontWeight: 800, letterSpacing: '.1em'}}>ぜんたいの流れ</div>
      <div style={{fontSize: 58, fontWeight: 850, marginTop: 12, letterSpacing: '-.03em'}}>
        試して、決めて、残りを1組ずつ。
      </div>
    </Pop>
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 18, marginTop: 66}}>
      {STEPS.map(([n, title, note], i) => (
        <Pop key={n} delay={cue(speech, 0.17 + i * 0.09)}>
          <div
            style={{
              background: T.surface,
              border: `1px solid ${T.line}`,
              borderRadius: 14,
              padding: 26,
              height: 300,
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: T.turf,
                color: '#fff',
                fontSize: 26,
                fontWeight: 850,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {n}
            </div>
            <div style={{fontSize: 27, fontWeight: 850, marginTop: 22, lineHeight: 1.35}}>{title}</div>
            <div style={{fontSize: 19, color: T.muted, marginTop: 12, lineHeight: 1.6}}>{note}</div>
          </div>
        </Pop>
      ))}
    </div>
    <Pop delay={cue(speech, 0.72)}>
      <div style={{marginTop: 44, fontSize: 24, color: T.muted}}>
        試しただけでは割当は動かない。決めるのは「この配置で決める」と「この人にする」。
      </div>
    </Pop>
  </AbsoluteFill>
);

/** 日付の入力欄と、当日の稼働サマリーの矩形。 */
const DATE_BOX = {x: CONTENT.left, y: L.barTop + 5, w: 170, h: 36} as const;
const SUMMARY_CHIPS = {x: CONTENT.left + 186, y: L.barTop + 6, w: 200, h: 34} as const;

const EntryScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  const picked = cue(speech, 0.34);
  const after = frame >= picked + 2;
  return (
    <Stage
      step={1}
      label="日付をえらぶ"
      caption="上の日付で、決める日をえらぶ。当日でも先の日でも同じ。未配置と配置済みの組数がすぐ出る。"
      narration={<Narration id="entry" />}
      overlay={
        <>
          <Ring x={DATE_BOX.x} y={DATE_BOX.y} width={DATE_BOX.w} height={DATE_BOX.h} from={cue(speech, 0.2)} to={cue(speech, 0.6)} />
          <Ring x={SUMMARY_CHIPS.x} y={SUMMARY_CHIPS.y} width={SUMMARY_CHIPS.w} height={SUMMARY_CHIPS.h} from={cue(speech, 0.74)} to={cue(speech, 1)} />
          <Cursor
            stops={[
              {at: cue(speech, 0.06), x: 900, y: 700},
              {at: picked - 6, x: DATE_BOX.x + 84, y: DATE_BOX.y + 18},
              {at: cue(speech, 0.66), x: DATE_BOX.x + 84, y: DATE_BOX.y + 18},
              {at: cue(speech, 0.8), x: SUMMARY_CHIPS.x + 120, y: SUMMARY_CHIPS.y + 40},
              {at: cue(speech, 1), x: SUMMARY_CHIPS.x + 120, y: SUMMARY_CHIPS.y + 40},
            ]}
            clicks={[{at: picked, x: DATE_BOX.x + 90, y: DATE_BOX.y + 24}]}
          />
        </>
      }
    >
      <DispatchBody
        date={after ? DATE_TARGET : DATE_TODAY}
        unassigned={after ? 4 : 0}
        assigned={after ? 0 : 6}
        dateFocused={frame >= picked - 8 && frame < cue(speech, 0.66)}
        rows={after ? GROUPS : []}
        auto={<AutoAssignPanel />}
      />
    </Stage>
  );
};

const PreviewScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  const pressed = cue(speech, 0.36);
  const planAt = pressed + 22;
  const busy = frame >= pressed && frame < planAt ? 'preview' : undefined;
  return (
    <Stage
      step={2}
      label="自動で試す"
      caption="「配置を試す」は候補を並べるだけ。この時点では、まだ何も決まっていない。"
      narration={<Narration id="preview" />}
      overlay={
        <>
          <Ring x={AUTO_PREVIEW.x} y={AUTO_PREVIEW.y} width={AUTO_PREVIEW.w} height={AUTO_PREVIEW.h} from={cue(speech, 0.14)} to={pressed + 6} />
          <Cursor
            stops={[
              {at: cue(speech, 0.04), x: 900, y: 700},
              {at: pressed - 6, x: AUTO_PREVIEW.x + AUTO_PREVIEW.w / 2, y: AUTO_PREVIEW.y + 18},
              {at: cue(speech, 1), x: AUTO_PREVIEW.x + AUTO_PREVIEW.w / 2, y: AUTO_PREVIEW.y + 18},
            ]}
            clicks={[{at: pressed, x: AUTO_PREVIEW.x + AUTO_PREVIEW.w / 2 + 6, y: AUTO_PREVIEW.y + 24}]}
          />
        </>
      }
    >
      <DispatchBody
        date={DATE_TARGET}
        unassigned={4}
        assigned={0}
        rows={GROUPS}
        auto={<AutoAssignPanel busy={busy} plan={frame >= planAt} />}
      />
    </Stage>
  );
};

const ExecuteScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  const pressed = cue(speech, 0.42);
  const doneAt = pressed + 18;
  const busy = frame >= pressed && frame < doneAt ? 'execute' : undefined;
  const done = frame >= doneAt;
  return (
    <Stage
      step={3}
      label="この配置で決める"
      caption="候補を見てよければ「この配置で決める」。割り当てた件数と、飛ばした件数が出る。"
      narration={<Narration id="execute" />}
      overlay={
        <>
          <Ring x={AUTO_EXECUTE.x} y={AUTO_EXECUTE.y} width={AUTO_EXECUTE.w} height={AUTO_EXECUTE.h} from={cue(speech, 0.2)} to={pressed + 6} />
          <Ring
            x={AUTO_EXECUTE.x}
            y={AUTO_EXECUTE.y + 42 + 14}
            width={AUTO_EXECUTE.w}
            height={72}
            from={doneAt + 6}
            to={cue(speech, 1)}
          />
          <Cursor
            stops={[
              {at: cue(speech, 0.04), x: 900, y: 700},
              {at: pressed - 6, x: AUTO_EXECUTE.x + AUTO_EXECUTE.w / 2, y: AUTO_EXECUTE.y + 18},
              {at: cue(speech, 1), x: AUTO_EXECUTE.x + AUTO_EXECUTE.w / 2, y: AUTO_EXECUTE.y + 18},
            ]}
            clicks={[{at: pressed, x: AUTO_EXECUTE.x + AUTO_EXECUTE.w / 2 + 6, y: AUTO_EXECUTE.y + 24}]}
          />
        </>
      }
    >
      <DispatchBody
        date={DATE_TARGET}
        unassigned={done ? 1 : 4}
        assigned={done ? 3 : 0}
        rows={done ? [GROUPS[3]] : GROUPS}
        auto={<AutoAssignPanel busy={busy} plan done={done} />}
      />
    </Stage>
  );
};

/** 「担当を決める」シート。窓の右端から出て、窓の高さいっぱいに広がる。 */
const SHEET = {w: 560, x: WINDOW.left + WINDOW.width - 560, top: WINDOW.top, h: WINDOW.height, pad: 28} as const;
const CANDIDATE_H = 92;
const CANDIDATE_GAP = 8;
const CANDIDATES_TOP = SHEET.top + SHEET.pad + 30 + 6 + 24 + 20;
const PICK_BTN = {w: 118, x: SHEET.x + SHEET.w - SHEET.pad - 118} as const;
const CANDIDATE_Y = (i: number) => CANDIDATES_TOP + i * (CANDIDATE_H + CANDIDATE_GAP) + CANDIDATE_H / 2;

const CANDIDATES = [
  {name: '高橋 みどり', why: '評価平均 4.6 · この日はあと2回担当できます · 経験: ベテラン'},
  {name: '井上 翔', why: '評価の記録なし · この日はあと2回担当できます · 経験: ふつう'},
  {name: '森 京子', why: '評価平均 4.1 · この日はあと1回担当できます · 経験: 新人 · 新人を 高橋 みどり さんと組ませます'},
] as const;

const PickSheet = ({openAt, closeAt}: {openAt: number; closeAt: number}) => {
  const frame = useCurrentFrame();
  const open = interpolate(frame, [openAt, openAt + 12], [0, 1], EASE);
  const close = interpolate(frame, [closeAt, closeAt + 10], [0, 1], EASE);
  const p = open * (1 - close);
  if (p <= 0) return null;
  return (
    <>
      <div
        style={{
          position: 'absolute',
          ...WINDOW,
          borderRadius: 16,
          background: 'rgba(20,40,32,.28)',
          opacity: p,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: SHEET.x,
          top: SHEET.top,
          width: SHEET.w,
          height: SHEET.h,
          boxSizing: 'border-box',
          padding: SHEET.pad,
          background: '#fff',
          borderRadius: '0 16px 16px 0',
          boxShadow: '-16px 0 40px rgba(20,40,32,.18)',
          transform: `translateX(${(1 - p) * SHEET.w}px)`,
          fontFamily: FONT,
          color: T.ink,
        }}
      >
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
          <div style={{fontSize: 22, fontWeight: 800, lineHeight: '30px'}}>担当を決める</div>
          <span style={{fontSize: 22, color: T.muted}}>×</span>
        </div>
        <div style={{fontSize: 16, color: T.muted, lineHeight: '24px', marginTop: 6}}>
          9月5日 08:28 · 東コース
        </div>
        <div style={{marginTop: 20}}>
          {CANDIDATES.map((c, i) => (
            <div
              key={c.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                height: CANDIDATE_H,
                boxSizing: 'border-box',
                padding: '0 14px',
                marginBottom: CANDIDATE_GAP,
                border: `1px solid ${T.line}`,
                borderRadius: 10,
                background: '#fff',
              }}
            >
              <span
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  background: T.turfSoft,
                  color: T.turf,
                  fontSize: 15,
                  fontWeight: 800,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {i + 1}番
              </span>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontSize: 18, fontWeight: 800, lineHeight: '24px'}}>{c.name}</div>
                <div style={{fontSize: 14, color: T.muted, lineHeight: '19px', marginTop: 2}}>{c.why}</div>
              </div>
              <Btn label="この人にする" variant="primary" size="sm" style={{width: PICK_BTN.w}} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

const PickScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  const opened = cue(speech, 0.38);
  const picked = cue(speech, 0.84);
  const closedAt = picked + 6;
  const namedAt = picked + 14;
  const named = frame >= namedAt;
  return (
    <Stage
      step={4}
      label="残りを1組ずつ"
      caption="飛ばされた組は「キャディを決める」から。おすすめの候補が順に並び、「この人にする」で決まる。"
      narration={<Narration id="pick" />}
      overlay={
        <>
          <Ring x={NAME_BTN.x} y={UNASSIGNED_ROW_Y(0) - 18} width={NAME_BTN.width} height={36} from={cue(speech, 0.24)} to={opened + 4} />
          <PickSheet openAt={opened + 2} closeAt={closedAt} />
          <Ring x={PICK_BTN.x} y={CANDIDATE_Y(0) - 18} width={PICK_BTN.w} height={36} from={cue(speech, 0.7)} to={picked + 4} />
          <Cursor
            stops={[
              {at: cue(speech, 0.04), x: 900, y: 700},
              {at: opened - 6, x: NAME_BTN.x + 68, y: UNASSIGNED_ROW_Y(0) - 6},
              {at: cue(speech, 0.5), x: NAME_BTN.x + 68, y: UNASSIGNED_ROW_Y(0) - 6},
              {at: picked - 8, x: PICK_BTN.x + 52, y: CANDIDATE_Y(0) - 6},
              {at: picked + 6, x: PICK_BTN.x + 52, y: CANDIDATE_Y(0) - 6},
              {at: picked + 30, x: 1500, y: 720},
              {at: cue(speech, 1), x: 1500, y: 720},
            ]}
            clicks={[
              {at: opened, x: NAME_BTN.x + 74, y: UNASSIGNED_ROW_Y(0)},
              {at: picked, x: PICK_BTN.x + 58, y: CANDIDATE_Y(0)},
            ]}
          />
        </>
      }
    >
      <DispatchBody
        date={DATE_TARGET}
        unassigned={named ? 0 : 1}
        assigned={named ? 4 : 3}
        rows={named ? [] : [GROUPS[3]]}
        flash={
          named ? (
            <Pop>
              <Notice tone="info" style={{marginBottom: 14}}>
                高橋 みどり を担当にしました
              </Notice>
              <div style={{textAlign: 'center', padding: '40px 0'}}>
                <div style={{fontSize: 22, fontWeight: 800}}>すべての組に担当がいます</div>
                <div style={{fontSize: 16, color: T.muted, marginTop: 10}}>
                  この日のキャディ付きの予約は、すべて担当が決まっています。
                </div>
              </div>
            </Pop>
          ) : undefined
        }
        auto={<AutoAssignPanel plan done />}
      />
    </Stage>
  );
};

/** 「この日の割当」の表。i 行目の中心 y は BOARD_ROW_Y(i)。 */
const BOARD_TOP = L.sectionTop + 28 + 6 + 22 + 12;
const BOARD_HEADER_H = 44;
const BOARD_ROW_H = 64;
const BOARD_ROW_Y = (i: number) => BOARD_TOP + BOARD_HEADER_H + i * BOARD_ROW_H + BOARD_ROW_H / 2;
const BOARD_RIGHT = CONTENT.left + CONTENT.width - 10;
const CANCEL_BTN = {w: 88, x: BOARD_RIGHT - 88} as const;
const COMPLETE_BTN = {w: 62, x: BOARD_RIGHT - 88 - 8 - 62} as const;
const MOVE_BTN = {w: 88, x: BOARD_RIGHT - 88 - 8 - 62 - 8 - 88} as const;

const BOARD_COLS = '110px 1fr 220px 120px 130px 300px';

const FixScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  const completed = cue(speech, 0.8);
  const rowDone = frame >= completed + 2;
  return (
    <Stage
      step={5}
      label="割当を直す"
      caption="直すときは「この日の割当」から。付け替えで別のキャディへ。終わったら完了、やめるなら取り消し。"
      narration={<Narration id="fix" />}
      overlay={
        <>
          <Ring x={MOVE_BTN.x} y={BOARD_ROW_Y(0) - 18} width={MOVE_BTN.w} height={36} from={cue(speech, 0.34)} to={cue(speech, 0.62)} />
          <Cursor
            stops={[
              {at: cue(speech, 0.04), x: 900, y: 760},
              {at: cue(speech, 0.34), x: MOVE_BTN.x + 40, y: BOARD_ROW_Y(0) - 6},
              {at: cue(speech, 0.62), x: MOVE_BTN.x + 40, y: BOARD_ROW_Y(0) - 6},
              {at: completed - 6, x: COMPLETE_BTN.x + 26, y: BOARD_ROW_Y(0) - 6},
              {at: cue(speech, 1), x: COMPLETE_BTN.x + 26, y: BOARD_ROW_Y(0) - 6},
            ]}
            clicks={[{at: completed, x: COMPLETE_BTN.x + 32, y: BOARD_ROW_Y(0)}]}
          />
        </>
      }
    >
      <DispatchTabs />
      <SummaryBar date={DATE_TARGET} unassigned={0} assigned={4} />
      <div style={{marginTop: 16}}>
        <div style={{fontSize: 20, fontWeight: 800, lineHeight: '28px', display: 'flex', alignItems: 'center', gap: 10}}>
          <span style={{fontSize: 16, color: T.muted}}>▾</span>
          配置済み 4組
        </div>
        <div style={{fontSize: 15, color: T.muted, lineHeight: '22px', marginTop: 6}}>
          担当を変えるときは、その行の「付け替え」から。別のキャディに移すことも、同じキャディを別の組に移すこともできます。
        </div>
      </div>
      <div style={{marginTop: 12, display: 'grid', gridTemplateColumns: BOARD_COLS}}>
        {['予定', '予約・ラウンド', 'キャディ', '費用', '状態', '操作'].map((h, i) => (
          <div
            key={h}
            style={{
              height: BOARD_HEADER_H,
              boxSizing: 'border-box',
              padding: '0 10px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: i >= 3 && i !== 4 ? 'flex-end' : 'flex-start',
              fontSize: 15,
              fontWeight: 700,
              color: T.muted,
              background: '#f6f8f7',
            }}
          >
            {h}
          </div>
        ))}
        {GROUPS.map((g, i) => {
          const done = i === 0 && rowDone;
          const cell = (children: ReactNode, align: 'start' | 'end' = 'start') => (
            <div
              style={{
                height: BOARD_ROW_H,
                boxSizing: 'border-box',
                padding: '0 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: align === 'end' ? 'flex-end' : 'flex-start',
                gap: 8,
                borderBottom: `1px solid ${T.line}`,
                fontSize: 17,
              }}
            >
              {children}
            </div>
          );
          return (
            <div key={g.time} style={{display: 'contents'}}>
              {cell(<span style={{fontWeight: 800, fontVariantNumeric: 'tabular-nums'}}>{g.time}</span>)}
              {cell(
                <div>
                  <div style={{fontWeight: 700, lineHeight: '22px'}}>{g.party}</div>
                  <div style={{fontSize: 14, color: T.muted, lineHeight: '18px'}}>
                    {g.course} · {g.players}名 · 主担当
                  </div>
                </div>,
              )}
              {cell(<span style={{color: T.turfDark, fontWeight: 700}}>{g.caddie}</span>)}
              {cell(<span style={{fontVariantNumeric: 'tabular-nums'}}>￥4,400</span>, 'end')}
              {cell(<Badge label={done ? '完了' : '割当ずみ'} variant={done ? 'success' : 'neutral'} />)}
              {cell(
                done ? (
                  <span style={{color: T.muted}}>—</span>
                ) : (
                  <>
                    <Btn label="付け替え" size="sm" style={{width: MOVE_BTN.w}} />
                    <Btn label="完了" size="sm" style={{width: COMPLETE_BTN.w}} />
                    <Btn label="取り消し" size="sm" variant="ghost" tone="danger" style={{width: CANCEL_BTN.w}} />
                  </>
                ),
                'end',
              )}
            </div>
          );
        })}
      </div>
    </Stage>
  );
};

/** 「キャディ付き枠」の予備に残す組数の入力欄。 */
const BUFFER_INPUT = {w: 140, x: CONTENT.left + CONTENT.width - L.pad - 140, y: L.sectionTop + 28 + 12 + L.pad + 26, h: 36} as const;

const Metric = ({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'success' | 'danger';
}) => (
  <div
    style={{
      border: `1px solid ${T.line}`,
      borderRadius: 10,
      padding: '14px 18px',
      height: 110,
      boxSizing: 'border-box',
      background: '#fff',
    }}
  >
    <div style={{fontSize: 15, color: T.muted}}>{label}</div>
    <div style={{fontSize: 34, fontWeight: 850, lineHeight: '40px', marginTop: 4}}>{value}</div>
    <div style={{fontSize: 14, marginTop: 4, color: tone === 'success' ? T.turfDark : tone === 'danger' ? T.danger : T.muted}}>
      {detail}
    </div>
  </div>
);

const SupplyScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  const typed = cue(speech, 0.72);
  const buffer = frame >= typed + 4 ? 1 : 0;
  return (
    <Stage
      label="人数の目安"
      caption="人数の目安は「キャディ付き枠」で。予備に残す組数を入れると、安全な上限がその分さがる。"
      narration={<Narration id="supply" />}
      overlay={
        <>
          <Ring
            x={CONTENT.left + L.pad}
            y={L.sectionTop + 28 + 12 + L.pad + 62 + 16}
            width={CONTENT.width - L.pad * 2}
            height={110}
            from={cue(speech, 0.16)}
            to={cue(speech, 0.6)}
          />
          <Ring x={BUFFER_INPUT.x} y={BUFFER_INPUT.y} width={BUFFER_INPUT.w} height={BUFFER_INPUT.h} from={cue(speech, 0.62)} to={cue(speech, 1)} />
          <Cursor
            stops={[
              {at: cue(speech, 0.04), x: 900, y: 760},
              {at: typed - 6, x: BUFFER_INPUT.x + 70, y: BUFFER_INPUT.y + 18},
              {at: cue(speech, 1), x: BUFFER_INPUT.x + 70, y: BUFFER_INPUT.y + 18},
            ]}
            clicks={[{at: typed, x: BUFFER_INPUT.x + 76, y: BUFFER_INPUT.y + 24}]}
          />
        </>
      }
    >
      <DispatchTabs />
      <SummaryBar date={DATE_TARGET} unassigned={0} assigned={4} />
      <div style={{marginTop: 16, fontSize: 20, fontWeight: 800, lineHeight: '28px', display: 'flex', alignItems: 'center', gap: 10}}>
        <span style={{fontSize: 16, color: T.muted}}>▾</span>
        人数の目安・コース別の過不足・おすすめの候補
      </div>
      <MockPanel
        title="キャディ付き枠"
        description="出勤の希望と 2ラウンドできるかから、安全に売れる上限を出します。売る枠そのものを変えるときはプレー商品の画面で。"
        actions={
          <div style={{width: BUFFER_INPUT.w}}>
            <div style={{fontSize: 15, color: T.muted, lineHeight: '20px', marginBottom: 6}}>予備に残す組数</div>
            <div
              style={{
                height: BUFFER_INPUT.h,
                boxSizing: 'border-box',
                borderRadius: 8,
                border: `1px solid ${frame >= typed - 8 ? T.turf : T.line}`,
                boxShadow: frame >= typed - 8 ? `0 0 0 3px ${T.turf}22` : 'none',
                display: 'flex',
                alignItems: 'center',
                padding: '0 12px',
                fontSize: 17,
                background: '#fff',
              }}
            >
              {buffer}
            </div>
          </div>
        }
        style={{marginTop: 12}}
      >
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14}}>
          <Metric label="出せる組数" value="7組" detail="出勤できる 6人 · 2R可 1人" />
          <Metric label="安全な上限" value={`${7 - buffer}組`} detail={`予備 ${buffer}組`} />
          <Metric label="予約ずみ" value="4組" detail="キャディ付きの予約" />
          <Metric label="残りの枠" value={`${3 - buffer}組`} detail="まだ受けられます" tone="success" />
        </div>
        <div style={{fontSize: 14, color: T.muted, marginTop: 12}}>午前に出られる 6人 · 午後に出られる 5人</div>
      </MockPanel>
      <MockPanel
        title="コース別の過不足"
        description="その日、どのコースに何人いて、何組を受けているかを並べます。足りないコースへは他のコースから応援を呼べます。"
        style={{marginTop: 16}}
      >
        <div style={{display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 1fr'}}>
          {['コース', '出勤', '受けられる組数', 'キャディ付き予約', '過不足'].map((h) => (
            <div key={h} style={{padding: '8px 10px', fontSize: 14, fontWeight: 700, color: T.muted, background: '#f6f8f7'}}>
              {h}
            </div>
          ))}
          {[
            ['東コース', '4人', '4組', '3組', '1組ぶん余裕'],
            ['西コース', '2人', '3組', '1組', '2組ぶん余裕'],
          ].flatMap((row) =>
            row.map((cell, i) => (
              <div
                key={`${row[0]}-${i}`}
                style={{
                  padding: '9px 10px',
                  fontSize: 16,
                  borderBottom: `1px solid ${T.line}`,
                  fontWeight: i === 0 ? 700 : 400,
                  color: i === 4 ? T.turfDark : T.ink,
                }}
              >
                {cell}
              </div>
            )),
          )}
        </div>
      </MockPanel>
    </Stage>
  );
};

const SummaryScene = ({speech}: SceneProps) => (
  <AbsoluteFill
    style={{
      fontFamily: FONT,
      background: `linear-gradient(135deg, ${T.turfDark}, #0d2a22)`,
      color: '#fff',
      padding: '90px 110px',
    }}
  >
    <Narration id="summary" />
    <Pop>
      <div style={{fontSize: 24, color: '#b8e55d', fontWeight: 800, letterSpacing: '.12em'}}>まとめ</div>
      <div style={{fontSize: 60, fontWeight: 850, marginTop: 14, letterSpacing: '-.03em'}}>
        日付 → 試す → 決める → 1組ずつ → 直す
      </div>
    </Pop>
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 60}}>
      {[
        ['試しただけでは変わらない', '「配置を試す」は候補を並べるだけ。決めるまで割当は動かない。'],
        ['決めるのは2つのボタン', 'まとめてなら「この配置で決める」。1組ずつなら「この人にする」。'],
        ['直すのは「この日の割当」から', '付け替え・完了・取り消しは、その行の操作から。'],
      ].map(([title, note], i) => (
        <Pop key={title} delay={cue(speech, 0.04 + i * 0.24)}>
          <div
            style={{
              border: '1px solid #3f6f5e',
              borderRadius: 14,
              padding: 28,
              height: 250,
              boxSizing: 'border-box',
              background: 'rgba(255,255,255,.04)',
            }}
          >
            <div style={{fontSize: 28, fontWeight: 850, lineHeight: 1.35}}>{title}</div>
            <div style={{fontSize: 20, color: '#cfe2da', marginTop: 16, lineHeight: 1.7}}>{note}</div>
          </div>
        </Pop>
      ))}
    </div>
    <Pop delay={cue(speech, 0.8)}>
      <div style={{marginTop: 58, display: 'flex', alignItems: 'center', gap: 26}}>
        <Logo light width={210} />
        <div style={{fontSize: 24, color: '#cfe2da'}}>
          出勤の打刻がまだでも決められる。打刻は「出勤」タブで。
        </div>
      </div>
    </Pop>
  </AbsoluteFill>
);

// ── 組み立て ────────────────────────────────────────────────────────────────

/** 画面の順。尺は読み上げの長さから決まるので、ここには持たせない。 */
const SCENES = [
  ['title', TitleScene],
  ['overview', OverviewScene],
  ['entry', EntryScene],
  ['preview', PreviewScene],
  ['execute', ExecuteScene],
  ['pick', PickScene],
  ['fix', FixScene],
  ['supply', SupplyScene],
  ['summary', SummaryScene],
] as const satisfies readonly (readonly [NarrationId, (props: SceneProps) => ReactElement])[];

const FADE = 12;

export const DISPATCH_TUTORIAL_FRAMES =
  SCENES.reduce((total, [id]) => total + sceneFrames(id), 0) - FADE * (SCENES.length - 1);

const TIMING = linearTiming({durationInFrames: FADE});

export const DispatchTutorial = () => (
  <AbsoluteFill style={{background: T.canvas}}>
    <TransitionSeries>
      {SCENES.flatMap(([id, Scene], index) => [
        ...(index === 0
          ? []
          : [
              <TransitionSeries.Transition
                key={`${id}-in`}
                presentation={fade()}
                timing={TIMING}
              />,
            ]),
        <TransitionSeries.Sequence
          key={id}
          durationInFrames={sceneFrames(id)}
          premountFor={index === 0 ? undefined : 20}
        >
          <Scene speech={speechFrames(id)} />
        </TransitionSeries.Sequence>,
      ])}
    </TransitionSeries>
  </AbsoluteFill>
);

export const DispatchTutorialPoster = () => (
  <AbsoluteFill
    style={{
      fontFamily: FONT,
      background: `linear-gradient(135deg, ${T.turfDark}, #0d2a22)`,
      color: '#fff',
      padding: 110,
      justifyContent: 'center',
    }}
  >
    <Logo light width={230} />
    <div style={{marginTop: 60, fontSize: 26, color: '#b8e55d', letterSpacing: '.16em', fontWeight: 800}}>
      つかいかた ／ キャディの配置
    </div>
    <div style={{marginTop: 22, fontSize: 88, lineHeight: 1.18, fontWeight: 850, letterSpacing: '-.045em'}}>
      その日のキャディ配置を、
      <br />
      決める
    </div>
    <div style={{marginTop: 32, fontSize: 30, color: '#cfe2da'}}>
      日付 → 試す → 決める → 1組ずつ → 直す
    </div>
  </AbsoluteFill>
);
