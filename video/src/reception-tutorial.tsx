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
import narration from './narration.json';

/**
 * 受付の使い方動画。
 *
 * 見せているのは desktop の受付画面（`desktop/src/features/golf/customers/
 * reception/ReceptionPage.tsx`）で、文言は日本語 locale の
 * `customers.reception.*` に合わせてある。画面は実物の写しではなく再現なので、
 * UI を変えたときはここも直す。
 *
 * 名前・電話・住所はすべて架空のデモ値で、実在の顧客は含まない。
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
  paper: '#fbf9f3',
  /** 動画の注釈だけに使う赤。画面の色（緑・砂）と混ざらないよう UI では使わない。 */
  guide: '#e23b2e',
} as const;

const CLAMP = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};
const EASE = {...CLAMP, easing: Easing.inOut(Easing.ease)};

/** 画面モックの内側。カーソル座標はすべて動画全体（1920×1080）の絶対座標で書く。 */
const WINDOW = {left: 120, top: 104, width: 1680, height: 780} as const;
const CONTENT = {left: 356, top: 178, width: 1416, height: 678} as const;

// ── ナレーション ────────────────────────────────────────────────────────────

/**
 * シーンの尺は原稿ではなく音声そのものから決める。`npm run narration` が
 * 音声と `narration.json` を作り直すので、原稿を直せば尺も勝手に合う。
 */
const FPS = 30;
/** 音声が鳴り出すまでの間。ちょうど直前のトランジションが終わる長さ。 */
const LEAD = 12;
/** 言い終わってから次のシーンへ移るまでの間。 */
const TAIL = 18;

type NarrationId = keyof typeof narration.clips;

const speechFrames = (id: NarrationId) =>
  Math.round(narration.clips[id].seconds * FPS);

const sceneFrames = (id: NarrationId) => speechFrames(id) + LEAD + TAIL;

/**
 * 画面の動きをナレーションの進み具合（0〜1）で置く。
 * 尺が変わっても「この言葉のあたりで押す」という関係が崩れない。
 */
const cue = (speech: number, ratio: number) => LEAD + Math.round(speech * ratio);

type SceneProps = {speech: number};

const Narration = ({id}: {id: NarrationId}) => (
  <Sequence from={LEAD}>
    <Audio src={staticFile(`audio/reception/${id}.wav`)} />
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

/** at フレームで現れる（0→1）。消したいときは戻り値を反転して使う。 */
const useAfter = (at: number, duration = 8) => {
  const frame = useCurrentFrame();
  return interpolate(frame, [at, at + duration], [0, 1], CLAMP);
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

/** 注目させたい範囲を囲む枠。from〜to のあいだだけ出る。 */
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
        // 対象の矩形をそのまま渡してもらい、囲みは少し外に逃がす。
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
          const active = item === '顧客台帳';
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

const Stage = ({
  step,
  label,
  breadcrumb,
  caption,
  narration,
  overlay,
  children,
}: {
  step?: number;
  label: string;
  breadcrumb: string;
  caption: ReactNode;
  /** このシーンで流す読み上げ。 */
  narration?: ReactNode;
  /** カーソルと強調枠。動画全体（1920×1080）の座標で置けるよう窓の外に出す。 */
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
      <div style={{fontSize: 21, color: T.muted}}>受付用紙から顧客を登録する</div>
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

    <AppWindow breadcrumb={breadcrumb}>{children}</AppWindow>
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
  actions,
  children,
  style,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}) => (
  <div
    style={{
      background: T.surface,
      border: `1px solid ${T.line}`,
      borderRadius: 12,
      padding: 22,
      boxSizing: 'border-box',
      ...style,
    }}
  >
    {title || actions ? (
      <div style={{display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 16}}>
        <div style={{flex: 1, minWidth: 0}}>
          {title ? <div style={{fontSize: 22, fontWeight: 800}}>{title}</div> : null}
          {description ? (
            <div style={{fontSize: 16, color: T.muted, marginTop: 6, lineHeight: 1.5}}>
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
  icon,
}: {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  icon?: ReactNode;
}) => {
  const skin =
    variant === 'primary'
      ? {background: T.turf, color: '#fff', border: `1px solid ${T.turf}`}
      : variant === 'ghost'
        ? {background: 'transparent', color: T.muted, border: '1px solid transparent'}
        : {background: '#fff', color: T.ink, border: `1px solid ${T.line}`};
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '11px 18px',
        borderRadius: 9,
        fontSize: 17,
        fontWeight: 700,
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.42 : 1,
        ...skin,
      }}
    >
      {icon}
      {label}
    </div>
  );
};

const Notice = ({tone, children}: {tone: 'warning' | 'danger' | 'info'; children: ReactNode}) => {
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
        padding: '13px 16px',
        fontSize: 17,
        lineHeight: 1.55,
        ...skin,
      }}
    >
      {children}
    </div>
  );
};

const Check = ({on, size = 26}: {on: boolean; size?: number}) => (
  <span
    style={{
      width: size,
      height: size,
      borderRadius: 6,
      flexShrink: 0,
      border: `2px solid ${on ? T.turf : '#b9c4bf'}`,
      background: on ? T.turf : '#fff',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    {on ? (
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 16 16">
        <path d="M3 8.4 6.4 11.8 13 5" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ) : null}
  </span>
);

const FieldBox = ({
  label,
  value,
  readAs,
  focused = false,
  width,
}: {
  label: string;
  value: string;
  readAs?: string;
  focused?: boolean;
  width?: number | string;
}) => (
  <div style={{width}}>
    <div style={{fontSize: 15, color: T.muted, marginBottom: 6}}>{label}</div>
    <div
      style={{
        padding: '11px 14px',
        borderRadius: 9,
        border: `1px solid ${focused ? T.turf : T.line}`,
        boxShadow: focused ? `0 0 0 3px ${T.turf}22` : 'none',
        background: '#fff',
        fontSize: 19,
      }}
    >
      {value}
    </div>
    {readAs ? (
      <div style={{fontSize: 14, color: T.sand, marginTop: 6}}>読み取り：{readAs}</div>
    ) : null}
  </div>
);

const SavedBadge = () => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 12px',
      borderRadius: 99,
      background: T.turfSoft,
      color: T.turfDark,
      fontSize: 15,
      fontWeight: 800,
    }}
  >
    <svg width={16} height={16} viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="7" fill="none" stroke={T.turf} strokeWidth={1.8} />
      <path d="M4.6 8.2 7 10.6 11.4 5.8" fill="none" stroke={T.turf} strokeWidth={2} strokeLinecap="round" />
    </svg>
    登録しました
  </span>
);

/** 右カラムに置く受付用紙。読み取りのもとになった紙という位置づけ。 */
const PaperSheet = ({
  scanFrom,
  scanFrames = 44,
}: {
  scanFrom?: number;
  /** 読み取り線が上から下まで走りきるフレーム数。読み上げの長さに合わせる。 */
  scanFrames?: number;
}) => {
  const frame = useCurrentFrame();
  const rows = [
    ['1', '渡邊　修', 'わたなべ おさむ', '090-0000-0001'],
    ['2', '山田　太郎', 'やまだ たろう', '090-0000-0002'],
    ['3', '佐藤　花子', 'さとう はなこ', '090-0000-0003'],
  ];
  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        background: T.paper,
        border: `1px solid #ded8c9`,
        borderRadius: 8,
        padding: 20,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div style={{fontSize: 18, fontWeight: 800, textAlign: 'center', letterSpacing: '.2em'}}>
        受　付　票
      </div>
      <div style={{fontSize: 13, color: '#948b76', textAlign: 'center', marginTop: 4}}>
        2026年9月2日　　組名：デモ組
      </div>
      <div style={{display: 'grid', gridTemplateColumns: '28px 1.1fr 1.15fr 1fr', marginTop: 16}}>
        {['', 'お名前', 'ふりがな', '電話番号'].map((h) => (
          <div
            key={h}
            style={{
              padding: '8px 6px',
              fontSize: 13,
              color: '#8b8371',
              borderBottom: '1px solid #d8d2c2',
            }}
          >
            {h}
          </div>
        ))}
        {rows.flatMap((row) =>
          row.map((cell, i) => (
            <div
              key={`${row[0]}-${i}`}
              style={{
                padding: '15px 6px',
                fontSize: i === 1 ? 16 : 13,
                color: i === 0 ? '#a39a86' : '#3a3a34',
                borderBottom: '1px solid #e2dccc',
                fontWeight: i === 1 ? 700 : 400,
              }}
            >
              {cell}
            </div>
          )),
        )}
      </div>
      <div style={{marginTop: 18, fontSize: 13, color: '#8b8371'}}>ご確認いただく事項</div>
      {['反社会的勢力でないことの表明・ゴルフ場利用約款の遵守', 'カート利用約款の遵守', 'クラブからの情報提供を受け取る'].map(
        (label, i) => (
          <div key={label} style={{display: 'flex', gap: 10, alignItems: 'center', marginTop: 11}}>
            <span
              style={{
                width: 17,
                height: 17,
                border: '1.5px solid #b5ad99',
                borderRadius: 3,
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                color: '#3a3a34',
              }}
            >
              {i < 2 ? '✓' : ''}
            </span>
            <span style={{fontSize: 13, color: '#5c584c'}}>{label}</span>
          </div>
        ),
      )}
      {scanFrom === undefined ? null : (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: interpolate(frame, [scanFrom, scanFrom + scanFrames], [10, 470], CLAMP),
            height: 3,
            background: '#b8e55d',
            boxShadow: '0 0 20px #b8e55d',
            opacity: interpolate(
              frame,
              [scanFrom + scanFrames, scanFrom + scanFrames + 12],
              [1, 0],
              CLAMP,
            ),
          }}
        />
      )}
    </div>
  );
};

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
    {/* 冒頭で見せたいのは中身なので、タイトルとロゴは動かさず最初から置く。 */}
    <Logo light width={230} />
    <div style={{marginTop: 56, fontSize: 26, color: '#b8e55d', letterSpacing: '.16em', fontWeight: 800}}>
      つかいかた
    </div>
    <div style={{marginTop: 20, fontSize: 84, lineHeight: 1.2, fontWeight: 850, letterSpacing: '-.04em'}}>
      受付用紙から、
      <br />
      顧客を登録する
    </div>
    <div style={{marginTop: 30, fontSize: 30, color: '#cfe2da', lineHeight: 1.6}}>
      スキャンした用紙を読み取り、直して、台帳に入れるまで。
    </div>
    <div style={{marginTop: 40, display: 'flex', gap: 14}}>
      {['5ステップ', '約1分半', '顧客台帳 › 受付'].map((chip) => (
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
  ['1', '用紙をえらぶ', 'スキャン画像かPDFを開く'],
  ['2', '読み取りを待つ', '書かれている人を拾う'],
  ['3', '用紙と見比べて直す', '読み取りはあくまで下書き'],
  ['4', '同意を確認する', '必須はチェックが要る'],
  ['5', '台帳に登録する', '1人ずつでもまとめてでも'],
] as const;

const OverviewScene = ({speech}: SceneProps) => (
  <AbsoluteFill style={{fontFamily: FONT, background: T.canvas, color: T.ink, padding: '92px 110px'}}>
    <Narration id="overview" />
    <Pop>
      <div style={{fontSize: 24, color: T.turf, fontWeight: 800, letterSpacing: '.1em'}}>ぜんたいの流れ</div>
      <div style={{fontSize: 58, fontWeight: 850, marginTop: 12, letterSpacing: '-.03em'}}>
        紙を読み取り、直して、登録する。
      </div>
    </Pop>
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 18, marginTop: 66}}>
      {STEPS.map(([n, title, note], i) => (
        <Pop key={n} delay={cue(speech, 0.17 + i * 0.075)}>
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
    <Pop delay={cue(speech, 0.62)}>
      <div style={{marginTop: 44, fontSize: 24, color: T.muted}}>
        登録するまで台帳には何も書かれない。読み取りの結果は画面でいくらでも直せる。
      </div>
    </Pop>
  </AbsoluteFill>
);

const EntryScene = ({speech}: SceneProps) => (
  <Stage
    step={1}
    label="入口"
    breadcrumb="CourseBoard ／ 顧客台帳"
    caption="顧客台帳の右上「受付用紙から登録する」からはじめる。"
    narration={<Narration id="entry" />}
    overlay={
      <>
        <Ring x={1534} y={200} width={218} height={46} from={cue(speech, 0.32)} to={cue(speech, 1)} />
        <Cursor
          stops={[
            {at: cue(speech, 0.1), x: 900, y: 700},
            {at: cue(speech, 0.5), x: 1630, y: 214},
            {at: cue(speech, 1), x: 1630, y: 214},
          ]}
          clicks={[{at: cue(speech, 0.55), x: 1636, y: 220}]}
        />
      </>
    }
  >
    <MockPanel
      title="顧客台帳"
      description="来場した人と会員を、ひとつの台帳で見る。"
      actions={
        <>
          <Btn label="架電リスト" />
          <Btn label="受付用紙から登録する" variant="primary" />
        </>
      }
    >
      <div
        style={{
          padding: '12px 16px',
          border: `1px solid ${T.line}`,
          borderRadius: 9,
          color: T.faint,
          fontSize: 17,
          marginBottom: 14,
        }}
      >
        名前・会員番号でさがす
      </div>
      <div style={{display: 'grid', gridTemplateColumns: '1.4fr .7fr .8fr .6fr'}}>
        {['氏名', '会員区分', '最終来場', '来場回数'].map((h) => (
          <div
            key={h}
            style={{
              padding: '13px 8px',
              fontSize: 16,
              color: T.muted,
              background: '#f6f8f7',
              fontWeight: 700,
            }}
          >
            {h}
          </div>
        ))}
        {[
          ['山田 太郎', '会員', '8月18日', '12回'],
          ['佐藤 花子', 'ビジター', '8月12日', '2回'],
          ['鈴木 一郎', '会員', '7月28日', '31回'],
          ['高橋 三郎', '会員', '7月14日', '8回'],
          ['田中 四郎', 'ビジター', '6月30日', '1回'],
        ].flatMap((row) =>
          row.map((cell, i) => (
            <div
              key={`${row[0]}-${i}`}
              style={{
                padding: '17px 8px',
                fontSize: 18,
                borderBottom: `1px solid ${T.line}`,
                fontWeight: i === 0 ? 700 : 400,
                color: i === 0 ? T.ink : T.muted,
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

const ChooseScene = ({speech}: SceneProps) => {
  const hint = useAfter(cue(speech, 0.5), 10);
  return (
    <Stage
      step={1}
      label="用紙をえらぶ"
      breadcrumb="CourseBoard ／ 顧客台帳 ／ 受付用紙から顧客を登録する"
      caption="JPEG・PNG・HEIC・PDF。1ファイル10MBまで。用紙そのものは保存されない。"
      narration={<Narration id="choose" />}
      overlay={
        <>
          <Ring x={968} y={584} width={192} height={44} from={cue(speech, 0.08)} to={cue(speech, 1)} />
          <Cursor
            stops={[
              {at: cue(speech, 0.03), x: 700, y: 780},
              {at: cue(speech, 0.18), x: 1028, y: 596},
              {at: cue(speech, 1), x: 1028, y: 596},
            ]}
            clicks={[{at: cue(speech, 0.21), x: 1034, y: 602}]}
          />
        </>
      }
    >
      <div style={{fontSize: 17, color: T.muted, marginBottom: 14}}>‹ 顧客台帳にもどる</div>
      <MockPanel
        title="受付用紙から顧客を登録する"
        description="受付用紙をスキャンした画像やPDFを読み取り、書かれている人を台帳に登録します。"
        actions={<Btn label="受付用紙をえらぶ" variant="primary" />}
      >
        <div style={{fontSize: 16, color: T.muted, lineHeight: 1.6}}>
          JPEG・PNG・HEIC/HEIF・PDFが読み取れます。1ファイル10MBまで。iPhoneで撮った写真はJPEGに変換してから読み取ります。用紙は保存されません。
        </div>
      </MockPanel>
      <MockPanel style={{marginTop: 18, height: 348, display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{textAlign: 'center'}}>
          <div style={{fontSize: 26, fontWeight: 800}}>受付用紙をえらんでください</div>
          <div style={{fontSize: 18, color: T.muted, marginTop: 12, lineHeight: 1.6, maxWidth: 700}}>
            スキャンした画像やPDFから、書かれている人を読み取ります。読み取った内容は登録する前に画面で直せます。
          </div>
          <div style={{marginTop: 26, display: 'flex', justifyContent: 'center'}}>
            <Btn label="受付用紙をえらぶ" variant="primary" />
          </div>
        </div>
      </MockPanel>
      <div style={{opacity: hint, marginTop: 18}}>
        <Notice tone="info">
          スマホで撮った写真でも読み取れる。まっすぐ・影なし・端まで写っていると読み取りが安定する。
        </Notice>
      </div>
    </Stage>
  );
};

const ReadingScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  return (
    <Stage
      step={2}
      label="読み取り中"
      breadcrumb="CourseBoard ／ 顧客台帳 ／ 受付用紙から顧客を登録する"
      caption="読み取りは下書き。この時点で台帳にはまだ何も書かれていない。"
      narration={<Narration id="reading" />}
    >
      <div style={{display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, height: '100%'}}>
        <MockPanel style={{display: 'flex', alignItems: 'center', justifyContent: 'center'}}>
          <div style={{textAlign: 'center'}}>
            <div
              style={{
                width: 66,
                height: 66,
                margin: '0 auto',
                borderRadius: '50%',
                border: `5px solid ${T.line}`,
                borderTopColor: T.turf,
                transform: `rotate(${frame * 11}deg)`,
              }}
            />
            <div style={{fontSize: 24, fontWeight: 800, marginTop: 26}}>
              受付用紙を読み取っています。
            </div>
            <div style={{fontSize: 19, color: T.muted, marginTop: 10}}>しばらくお待ちください。</div>
          </div>
        </MockPanel>
        <PaperSheet scanFrom={LEAD} scanFrames={speech} />
      </div>
    </Stage>
  );
};

const CompareScene = ({speech}: SceneProps) => {
  const corrected = useCurrentFrame() >= cue(speech, 0.46);
  const readAs = useAfter(cue(speech, 0.62), 8);
  return (
    <Stage
      step={3}
      label="用紙と見比べて直す"
      breadcrumb="CourseBoard ／ 顧客台帳 ／ 受付用紙から顧客を登録する"
      caption="右の用紙と見比べて直す。直すと、もとの読み取りが下に残る。"
      narration={<Narration id="compare" />}
      overlay={
        <>
          <Ring x={1394} y={286} width={132} height={44} from={cue(speech, 0.2)} to={cue(speech, 0.52)} />
          <Cursor
            stops={[
              {at: cue(speech, 0.06), x: 1100, y: 700},
              {at: cue(speech, 0.36), x: 560, y: 356},
              {at: cue(speech, 1), x: 560, y: 356},
            ]}
            clicks={[{at: cue(speech, 0.4), x: 566, y: 362}]}
          />
        </>
      }
    >
      <div style={{display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, height: '100%'}}>
        <MockPanel
          title="読み取った人"
          description="右の用紙と見比べて直してから登録してください。読み取りは下書きです。"
          actions={
            <>
              <Btn label="行を足す" variant="ghost" />
              <Btn label="まとめて登録する（3人）" variant="primary" />
            </>
          }
          style={{overflow: 'hidden'}}
        >
          <div
            style={{
              border: `1px solid ${T.line}`,
              borderRadius: 10,
              padding: 18,
              background: '#fff',
            }}
          >
            <div style={{fontSize: 18, fontWeight: 800, marginBottom: 14}}>1人目</div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
              <FieldBox
                label="氏名"
                value={corrected ? '渡邊 修' : '渡辺 修'}
                readAs={readAs > 0.5 ? '渡辺 修' : undefined}
                focused
              />
              <FieldBox label="ふりがな" value="わたなべ おさむ" />
              <FieldBox label="電話番号" value="090-0000-0001" />
              <FieldBox label="住所" value="デモ県デモ市1-2-3" />
            </div>
          </div>
          <div style={{display: 'flex', gap: 14, marginTop: 14}}>
            {['2人目　山田 太郎', '3人目　佐藤 花子'].map((label) => (
              <div
                key={label}
                style={{
                  flex: 1,
                  border: `1px solid ${T.line}`,
                  borderRadius: 10,
                  padding: '16px 18px',
                  fontSize: 18,
                  color: T.muted,
                  background: '#fafbfa',
                }}
              >
                {label}
              </div>
            ))}
          </div>
        </MockPanel>
        <PaperSheet />
      </div>
    </Stage>
  );
};

const ConsentScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  const ticks = [cue(speech, 0.34), cue(speech, 0.44)];
  const items = [
    {label: '反社会的勢力でないことの表明・ゴルフ場利用約款の遵守', required: true, at: ticks[0]},
    {label: 'カート利用約款の遵守', required: true, at: ticks[1]},
    {label: 'クラブからの情報提供を受け取る', required: false, at: -1},
  ];
  const cleared = ticks[1] + 4;
  const blocked = frame < cleared;
  return (
    <Stage
      step={4}
      label="同意を確認する"
      breadcrumb="CourseBoard ／ 顧客台帳 ／ 受付用紙から顧客を登録する"
      caption="必須の同意にチェックが入るまで登録できない。読めなかった項目は原本を見て入れる。"
      narration={<Narration id="consent" />}
      overlay={
        <Cursor
          stops={[
            {at: cue(speech, 0.04), x: 1020, y: 780},
            {at: ticks[0] - 6, x: 406, y: 396},
            {at: ticks[1] - 6, x: 406, y: 472},
            {at: cue(speech, 1), x: 406, y: 472},
          ]}
          clicks={[
            {at: ticks[0], x: 412, y: 402},
            {at: ticks[1], x: 412, y: 478},
          ]}
        />
      }
    >
      <MockPanel style={{height: '100%'}}>
        <div style={{fontSize: 20, fontWeight: 800, marginBottom: 6}}>1人目　渡邊 修</div>
        <div style={{fontSize: 16, color: T.muted, marginBottom: 20}}>
          用紙の同意欄を読み取った結果です。空欄と読み取れなかったところは見分けがつかないので、原本で確かめてください。
        </div>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 22}}>
          <FieldBox label="氏名" value="渡邊 修" readAs="渡辺 修" />
          <FieldBox label="ふりがな" value="わたなべ おさむ" />
          <FieldBox label="電話番号" value="090-0000-0001" />
        </div>
        {items.map((item) => {
          const on = item.at >= 0 && frame >= item.at;
          return (
            <div
              key={item.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '18px 18px',
                border: `1px solid ${T.line}`,
                borderRadius: 10,
                marginBottom: 12,
                background: '#fff',
              }}
            >
              <Check on={on} />
              <span style={{fontSize: 21, fontWeight: 700}}>{item.label}</span>
              {item.required ? (
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: 99,
                    border: `1px solid ${T.line}`,
                    fontSize: 14,
                    color: T.muted,
                  }}
                >
                  必須
                </span>
              ) : null}
              <span style={{marginLeft: 'auto', fontSize: 15, color: T.sand}}>
                {item.at < 0
                  ? '読み取り：チェックなし'
                  : on
                    ? '読み取り：読み取れず'
                    : '用紙から読み取れませんでした。原本を見て入力してください。'}
              </span>
            </div>
          );
        })}
        <div style={{marginTop: 18, opacity: interpolate(frame, [cleared, cleared + 10], [1, 0], CLAMP)}}>
          <Notice tone="warning">
            次の同意項目にチェックが必要です：反社会的勢力でないことの表明・ゴルフ場利用約款の遵守、カート利用約款の遵守。原本を確認してください。
          </Notice>
        </div>
        <div style={{display: 'flex', justifyContent: 'flex-end', marginTop: 24}}>
          <Btn label="この人を登録する" variant="primary" disabled={blocked} />
        </div>
      </MockPanel>
    </Stage>
  );
};

const RegisterScene = ({speech}: SceneProps) => {
  const frame = useCurrentFrame();
  const pressed = cue(speech, 0.34);
  const savedAt = [pressed + 10, pressed + 26, pressed + 42];
  const savedCount = savedAt.filter((at) => frame >= at).length;
  const pending = 3 - savedCount;
  return (
    <Stage
      step={5}
      label="台帳に登録する"
      breadcrumb="CourseBoard ／ 顧客台帳 ／ 受付用紙から顧客を登録する"
      caption="1人ずつでも、まとめてでも。登録した人はそのまま顧客のページをひらける。"
      narration={<Narration id="register" />}
      overlay={
        <>
          <Ring x={1068} y={200} width={246} height={46} from={cue(speech, 0.12)} to={pressed + 8} />
          <Cursor
            stops={[
              {at: cue(speech, 0.04), x: 900, y: 700},
              {at: pressed - 6, x: 1160, y: 214},
              {at: cue(speech, 1), x: 1160, y: 214},
            ]}
            clicks={[{at: pressed, x: 1166, y: 220}]}
          />
        </>
      }
    >
      <div style={{display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, height: '100%'}}>
        <MockPanel
          title="読み取った人"
          description="右の用紙と見比べて直してから登録してください。読み取りは下書きです。"
          actions={
            <>
              <Btn label="行を足す" variant="ghost" />
              <Btn
                label={pending > 0 ? `まとめて登録する（${pending}人）` : 'まとめて登録する（0人）'}
                variant="primary"
                disabled={pending === 0}
              />
            </>
          }
        >
          {savedCount > 0 ? (
            <div style={{fontSize: 17, color: T.muted, marginBottom: 14}}>
              この用紙から{savedCount}人を登録しました。
            </div>
          ) : null}
          {['渡邊 修', '山田 太郎', '佐藤 花子'].map((name, i) => {
            const saved = frame >= savedAt[i];
            return (
              <div
                key={name}
                style={{
                  border: `1px solid ${saved ? `${T.turf}55` : T.line}`,
                  borderRadius: 10,
                  padding: '18px 20px',
                  marginBottom: 12,
                  background: saved ? T.turfSoft : '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                }}
              >
                <span style={{fontSize: 19, fontWeight: 800, width: 84}}>{i + 1}人目</span>
                <span style={{fontSize: 21}}>{name}</span>
                {saved ? <SavedBadge /> : null}
                <span style={{marginLeft: 'auto'}}>
                  {saved ? (
                    <Btn label="顧客のページをひらく" variant="ghost" />
                  ) : (
                    <Btn label="この人を登録する" />
                  )}
                </span>
              </div>
            );
          })}
        </MockPanel>
        <PaperSheet />
      </div>
    </Stage>
  );
};

const FallbackScene = ({speech}: SceneProps) => (
  <Stage
    label="読み取れなかったとき"
    breadcrumb="CourseBoard ／ 顧客台帳 ／ 受付用紙から顧客を登録する"
    caption="読み取れなくても受付は止めない。用紙を見ながら「行を足す」で登録できる。"
    narration={<Narration id="fallback" />}
    overlay={<Ring x={955} y={200} width={114} height={46} from={cue(speech, 0.46)} to={cue(speech, 1)} />}
  >
    <div style={{display: 'grid', gridTemplateColumns: '1fr 420px', gap: 20, height: '100%'}}>
      <MockPanel
        title="読み取った人"
        description="右の用紙と見比べて直してから登録してください。読み取りは下書きです。"
        actions={
          <>
            <Btn label="行を足す" variant="secondary" />
            <Btn label="まとめて登録する（0人）" variant="primary" disabled />
          </>
        }
      >
        <Pop delay={cue(speech, 0.04)}>
          <Notice tone="danger">
            読み取りサービスが混み合っているため、いま読み取りできません。用紙の写りの問題ではありません。少し待ってからもう一度読み取るか、用紙を見ながら「行を足す」で登録してください。
          </Notice>
        </Pop>
        <Pop delay={cue(speech, 0.56)}>
          <div
            style={{
              marginTop: 18,
              border: `1px solid ${T.line}`,
              borderRadius: 10,
              padding: 18,
              background: '#fff',
            }}
          >
            <div style={{fontSize: 18, fontWeight: 800, marginBottom: 14}}>1人目</div>
            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
              <FieldBox label="氏名" value="渡邊 修" focused />
              <FieldBox label="ふりがな" value="わたなべ おさむ" />
            </div>
          </div>
        </Pop>
        <Pop delay={cue(speech, 0.76)}>
          <div style={{fontSize: 17, color: T.muted, marginTop: 16, lineHeight: 1.6}}>
            用紙の写りが悪いのか、読み取り自体が動かなかったのかは画面の文言で分かる。撮り直しで直らない文言のときは管理者に連絡する。
          </div>
        </Pop>
      </MockPanel>
      <PaperSheet />
    </div>
  </Stage>
);

const SettingsScene = ({speech}: SceneProps) => (
  <Stage
    label="用紙に合わせる"
    breadcrumb="CourseBoard ／ 顧客台帳 ／ 受付用紙から顧客を登録する"
    caption="用紙の項目が違うときは「受付票の項目設定」で合わせる。空の用紙から提案もできる。"
    narration={<Narration id="settings" />}
    overlay={<Ring x={1368} y={200} width={220} height={46} from={cue(speech, 0.52)} to={cue(speech, 1)} />}
  >
    <MockPanel
      title="受付票の項目設定"
      description="受付用紙にある標準項目と、ゴルフ場ごとの追加項目を設定します。ここでの設定は読み取り結果と登録画面に反映されます。"
      actions={
        <>
          <Btn label="空の用紙から提案する" />
          <Btn label="項目設定を保存" variant="primary" />
        </>
      }
      style={{height: '100%'}}
    >
      <div style={{fontSize: 19, fontWeight: 800, marginBottom: 4}}>標準項目</div>
      <div style={{fontSize: 16, color: T.muted, marginBottom: 16}}>
        氏名は常に表示・必須です。その他は用紙にある項目だけを有効にし、必要な項目を必須にできます。
      </div>
      <div style={{display: 'grid', gridTemplateColumns: '1.5fr .5fr .5fr 1.2fr'}}>
        {['項目', '表示', '必須', '呼び名'].map((h) => (
          <div
            key={h}
            style={{padding: '13px 10px', fontSize: 16, fontWeight: 700, color: T.muted, background: '#f6f8f7'}}
          >
            {h}
          </div>
        ))}
        {[
          ['氏名', 'name', true, true, '常に必須'],
          ['ふりがな', 'name_kana', true, false, ''],
          ['電話番号', 'phone', true, true, ''],
          ['住所', 'address', true, false, 'ご住所'],
          ['生年月日', 'birthday', false, false, ''],
        ].map((row, index) => (
          <Pop key={String(row[1])} delay={cue(speech, 0.08 + index * 0.05)} style={{display: 'contents'}}>
            <div style={{padding: '16px 10px', borderBottom: `1px solid ${T.line}`}}>
              <div style={{fontSize: 19, fontWeight: 700}}>{String(row[0])}</div>
              <div style={{fontSize: 14, color: T.faint, marginTop: 3}}>{String(row[1])}</div>
            </div>
            <div style={{padding: '16px 10px', borderBottom: `1px solid ${T.line}`}}>
              <Check on={Boolean(row[2])} size={22} />
            </div>
            <div style={{padding: '16px 10px', borderBottom: `1px solid ${T.line}`}}>
              <Check on={Boolean(row[3])} size={22} />
            </div>
            <div
              style={{
                padding: '16px 10px',
                borderBottom: `1px solid ${T.line}`,
                fontSize: 17,
                color: row[4] ? T.ink : T.faint,
              }}
            >
              {String(row[4] || '既定のまま')}
            </div>
          </Pop>
        ))}
      </div>
    </MockPanel>
  </Stage>
);

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
        えらぶ → 読み取る → 直す → 同意 → 登録
      </div>
    </Pop>
    <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginTop: 60}}>
      {[
        ['用紙は保存されない', '読み取りが終われば画面から消える。原本の管理はこれまでどおり。'],
        ['読み取りは下書き', '登録するまで台帳には何も書かれない。おかしければその場で直す。'],
        ['必須同意がないと登録できない', 'チェックが足りない行は登録ボタンが押せない。原本で確かめる。'],
      ].map(([title, note], i) => (
        <Pop key={title} delay={cue(speech, 0.04 + i * 0.22)}>
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
    <Pop delay={cue(speech, 0.76)}>
      <div style={{marginTop: 58, display: 'flex', alignItems: 'center', gap: 26}}>
        <Logo light width={210} />
        <div style={{fontSize: 24, color: '#cfe2da'}}>
          困ったときは、画面の文言のとおりに動けば戻れる。
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
  ['choose', ChooseScene],
  ['reading', ReadingScene],
  ['compare', CompareScene],
  ['consent', ConsentScene],
  ['register', RegisterScene],
  ['fallback', FallbackScene],
  ['settings', SettingsScene],
  ['summary', SummaryScene],
] as const satisfies readonly (readonly [NarrationId, (props: SceneProps) => ReactElement])[];

const FADE = 12;

export const RECEPTION_TUTORIAL_FRAMES =
  SCENES.reduce((total, [id]) => total + sceneFrames(id), 0) - FADE * (SCENES.length - 1);

const TIMING = linearTiming({durationInFrames: FADE});

export const ReceptionTutorial = () => (
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

export const ReceptionTutorialPoster = () => (
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
      つかいかた ／ 受付
    </div>
    <div style={{marginTop: 22, fontSize: 88, lineHeight: 1.18, fontWeight: 850, letterSpacing: '-.045em'}}>
      受付用紙から、
      <br />
      顧客を登録する
    </div>
    <div style={{marginTop: 32, fontSize: 30, color: '#cfe2da'}}>
      えらぶ → 読み取る → 直す → 同意 → 登録
    </div>
  </AbsoluteFill>
);
