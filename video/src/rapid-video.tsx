import {Audio} from '@remotion/media';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {slide} from '@remotion/transitions/slide';
import {
  AbsoluteFill,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

import {FONT} from './font';

const C = {
  ink: '#10212b',
  forest: '#174d3a',
  green: '#2f8061',
  mint: '#dff3e9',
  lime: '#b8e55d',
  cream: '#f6f3ea',
  white: '#ffffff',
  muted: '#60726b',
  orange: '#d88a43',
  red: '#c65b54',
};

const CLAMP = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};

const SECTION_THEMES = {
  reception: {
    name: '受付',
    english: 'RECEPTION',
    subtitle: '紙の情報を、顧客台帳へ',
    background: '#f5eee3',
    surface: '#fffdf8',
    soft: '#f8e7d3',
    accent: '#d88a43',
    ink: '#6b3e20',
    muted: '#8d7561',
    chrome: '#f0e8dd',
  },
  caddie: {
    name: 'キャディ',
    english: 'CADDIE',
    subtitle: '需給、配置、シフト、給与まで',
    background: '#e7f4eb',
    surface: '#fbfffc',
    soft: '#d8f0e2',
    accent: '#2f8061',
    ink: C.forest,
    muted: '#627a6c',
    chrome: '#e7f0ea',
  },
  reservation: {
    name: '予約',
    english: 'RESERVATIONS',
    subtitle: '一日の流れを、時間で見る。',
    background: '#e7f0f8',
    surface: '#fbfdff',
    soft: '#dcecf8',
    accent: '#4d7da5',
    ink: '#234a66',
    muted: '#6b7f8e',
    chrome: '#e7eef5',
  },
  customer: {
    name: '顧客管理',
    english: 'CUSTOMER',
    subtitle: '来場履歴と顧客情報を、ひとつに。',
    background: '#efeaf7',
    surface: '#fdfbff',
    soft: '#e6dcf5',
    accent: '#7955a6',
    ink: '#4b3670',
    muted: '#746887',
    chrome: '#eee9f4',
  },
} as const;

type SectionTheme = (typeof SECTION_THEMES)[keyof typeof SECTION_THEMES];

const Logo = ({light = false, width = 235}: {light?: boolean; width?: number}) => (
  <Img
    src={staticFile(
      light
        ? 'brand/courseboard-horizontal-reversed-transparent.png'
        : 'brand/courseboard-horizontal-primary-transparent.png',
    )}
    style={{width, height: width * 0.43, objectFit: 'contain'}}
  />
);

const Pop = ({children, delay = 0}: {children: React.ReactNode; delay?: number}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({
    frame: frame - delay,
    fps,
    durationInFrames: 12,
    config: {damping: 18, stiffness: 220},
  });
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${interpolate(p, [0, 1], [24, 0])}px) scale(${interpolate(p, [0, 1], [0.97, 1])})`,
      }}
    >
      {children}
    </div>
  );
};

const SceneCopy = ({
  number,
  kicker,
  title,
  body,
  theme,
}: {
  number: string;
  kicker: string;
  title: string;
  body: string;
  theme: SectionTheme;
}) => (
  <div style={{width: 480}}>
    <Pop delay={2}>
      <div
        style={{
          fontSize: 21,
          fontWeight: 800,
          color: theme.accent,
          letterSpacing: '0.11em',
        }}
      >
        {number} — {kicker}
      </div>
    </Pop>
    <div style={{height: 18}} />
    <Pop delay={7}>
      <div
        style={{
          color: theme.ink,
          fontSize: 62,
          fontWeight: 850,
          lineHeight: 1.18,
          letterSpacing: '-0.055em',
          whiteSpace: 'pre-line',
        }}
      >
        {title}
      </div>
    </Pop>
    <div style={{height: 22}} />
    <Pop delay={13}>
      <div style={{fontSize: 25, lineHeight: 1.6, color: theme.muted}}>
        {body}
      </div>
    </Pop>
  </div>
);

const Sidebar = ({active, theme}: {active: string; theme: SectionTheme}) => {
  const items = ['受付・顧客', 'キャディ需給', 'ラウンド配置', '別業務', 'シフト表', '出勤・給与', '予約台帳', '顧客台帳'];
  return (
    <div style={{width: 210, padding: '24px 18px', borderRight: '1px solid #e4e9e6', background: '#fbfcfb'}}>
      <Logo width={150} />
      <div style={{height: 24}} />
      {items.map((item) => (
        <div
          key={item}
          style={{
            padding: '11px 14px',
            marginBottom: 5,
            borderRadius: 10,
            background: item === active ? theme.soft : 'transparent',
            color: item === active ? theme.ink : '#6a7772',
            fontSize: 15,
            fontWeight: item === active ? 800 : 500,
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
};

const AppWindow = ({active, title, theme, children}: {active: string; title: string; theme: SectionTheme; children: React.ReactNode}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const drift = interpolate(frame, [0, 3.6 * fps], [0, -10], CLAMP);
  return (
    <div
      style={{
        width: 1260,
        height: 760,
        borderRadius: 26,
        overflow: 'hidden',
        background: theme.surface,
        boxShadow: '0 40px 100px rgba(16,33,43,0.2)',
        border: `1px solid ${theme.accent}30`,
        transform: `translateY(${drift}px)`,
      }}
    >
      <div style={{height: 42, background: theme.chrome, display: 'flex', alignItems: 'center', gap: 9, paddingLeft: 18}}>
        {[C.green, '#e7b44c', '#d76f5b'].map((color) => (
          <div key={color} style={{width: 11, height: 11, borderRadius: 8, background: color}} />
        ))}
      </div>
      <div style={{display: 'flex', height: 718}}>
        <Sidebar active={active} theme={theme} />
        <div style={{flex: 1, overflow: 'hidden'}}>
          <div
            style={{
              height: 58,
              borderBottom: '1px solid #e5e9e7',
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 26px',
              fontSize: 20,
              fontWeight: 800,
              color: C.ink,
            }}
          >
            <span>{title}</span>
            <span style={{fontSize: 14, fontWeight: 500, color: theme.muted}}>デモゴルフクラブ</span>
            <span style={{position: 'absolute', left: 26, bottom: -1, width: 92, height: 3, borderRadius: 3, background: theme.accent}} />
          </div>
          <div style={{padding: 24, height: 612, boxSizing: 'border-box', background: theme.surface}}>{children}</div>
        </div>
      </div>
    </div>
  );
};

const FeatureScene = ({
  number,
  kicker,
  title,
  body,
  active,
  screenTitle,
  children,
  theme,
}: {
  number: string;
  kicker: string;
  title: string;
  body: string;
  active: string;
  screenTitle: string;
  children: React.ReactNode;
  theme: SectionTheme;
}) => (
  <AbsoluteFill
    style={{
      fontFamily: FONT,
      background: theme.background,
      overflow: 'hidden',
    }}
  >
    <div style={{position: 'absolute', left: 72, top: 42, display: 'flex', alignItems: 'center', gap: 12}}>
      <span style={{padding: '7px 13px', borderRadius: 99, background: theme.soft, color: theme.ink, fontSize: 14, fontWeight: 850, letterSpacing: '.08em'}}>{theme.name}</span>
      <span style={{fontSize: 14, color: theme.muted, letterSpacing: '.14em', fontWeight: 700}}>{theme.english}</span>
    </div>
    <div style={{position: 'absolute', left: 72, top: 92}}>
      <SceneCopy number={number} kicker={kicker} title={title} body={body} theme={theme} />
    </div>
    <div style={{position: 'absolute', left: 565, top: 155}}>
      <Pop delay={9}>
        <AppWindow active={active} title={screenTitle} theme={theme}>
          {children}
        </AppWindow>
      </Pop>
    </div>
    <div
      style={{
        position: 'absolute',
        left: 74,
        bottom: 46,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        color: theme.muted,
        fontSize: 16,
      }}
    >
      <span style={{width: 64, height: 4, borderRadius: 4, background: theme.accent}} />
      CourseBoard
    </div>
  </AbsoluteFill>
);

const SectionDivider = ({theme, number}: {theme: SectionTheme; number: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = spring({frame, fps, durationInFrames: 12, config: {damping: 200}});
  const drift = interpolate(p, [0, 1], [34, 0]);
  return (
    <AbsoluteFill style={{fontFamily: FONT, background: theme.background, overflow: 'hidden'}}>
      <div style={{position: 'absolute', right: -180, top: -260, width: 760, height: 760, borderRadius: '50%', background: `radial-gradient(circle,${theme.soft},transparent 68%)`, opacity: 0.9}} />
      <div style={{position: 'absolute', left: 110, bottom: 82, height: 5, width: 190, borderRadius: 5, background: theme.accent, opacity: p}} />
      <div style={{position: 'absolute', left: 110, top: 300, opacity: p, transform: `translateY(${drift}px)`}}>
        <div style={{fontSize: 19, color: theme.accent, letterSpacing: '.16em', fontWeight: 850}}>SECTION {number} · {theme.english}</div>
        <div style={{marginTop: 20, fontSize: 108, lineHeight: 1, color: theme.ink, fontWeight: 850, letterSpacing: '-.07em'}}>{theme.name}</div>
        <div style={{marginTop: 26, fontSize: 28, color: theme.muted, fontWeight: 700}}>{theme.subtitle}</div>
      </div>
      <div style={{position: 'absolute', right: 165, bottom: 95, color: theme.accent, fontSize: 18, letterSpacing: '.12em', fontWeight: 800}}>CourseBoard</div>
    </AbsoluteFill>
  );
};

const Card = ({children, tint = C.white}: {children: React.ReactNode; tint?: string}) => (
  <div style={{background: tint, border: '1px solid #e0e6e2', borderRadius: 14, padding: 18}}>{children}</div>
);

const TimelineScreen = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const lineX = interpolate(frame, [0, 3.2 * fps], [70, 930], CLAMP);
  const blocks = [
    {left: 95, top: 52, width: 190, label: '青葉組  08:10', color: C.mint},
    {left: 310, top: 136, width: 230, label: 'ひかり組  09:20', color: '#fff0d8'},
    {left: 575, top: 52, width: 210, label: '若葉会  10:40', color: '#dfeaf7'},
    {left: 790, top: 136, width: 205, label: '午後クラブ  12:10', color: C.mint},
  ];
  return (
    <div>
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 14, color: C.muted}}>
        {['08:00', '09:00', '10:00', '11:00', '12:00', '13:00'].map((t) => <span key={t}>{t}</span>)}
      </div>
      <div style={{position: 'relative', height: 360, marginTop: 18, borderRadius: 14, background: 'repeating-linear-gradient(90deg,#f4f7f5 0,#f4f7f5 1px,transparent 1px,transparent 170px)'}}>
        {blocks.map((b, index) => {
          const p = spring({frame: frame - index * 4, fps, durationInFrames: 14, config: {damping: 200}});
          return (
            <div key={b.label} style={{position: 'absolute', left: b.left, top: b.top, width: b.width * p, height: 72, overflow: 'hidden', borderRadius: 12, background: b.color, padding: '16px 14px', boxSizing: 'border-box', whiteSpace: 'nowrap', fontSize: 15, fontWeight: 800, color: C.ink}}>
              {b.label}<div style={{fontSize: 13, color: C.muted, marginTop: 8}}>キャディ付き・3名</div>
            </div>
          );
        })}
        <div style={{position: 'absolute', left: lineX, top: 0, bottom: 0, width: 3, background: C.red, borderRadius: 3}} />
      </div>
    </div>
  );
};

const DispatchScreen = () => (
  <div>
    <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
      <div style={{display: 'flex', gap: 8}}><span style={{padding: '10px 18px', borderRadius: 10, background: C.forest, color: C.white, fontSize: 14, fontWeight: 850}}>ラウンド配置</span><span style={{padding: '10px 18px', borderRadius: 10, background: '#edf2ef', color: C.muted, fontSize: 14}}>別業務</span></div>
      <span style={{fontSize: 13, color: C.muted}}>サンプル表示</span>
    </div>
    <div style={{display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 16, marginTop: 16}}>
      <Card>
        <div style={{display: 'flex', justifyContent: 'space-between'}}><div style={{fontSize: 17, fontWeight: 850}}>未配置を解消する</div><span style={{fontSize: 13, color: C.orange, fontWeight: 800}}>未配置 3組</span></div>
        {[
          ['08:10', 'サンプル組A', '東コース'],
          ['09:20', 'サンプル組B', '西コース'],
          ['10:40', 'サンプル組C', '東コース'],
        ].map((row, index) => (
          <div key={row[1]} style={{display: 'grid', gridTemplateColumns: '65px 1fr 105px 125px', alignItems: 'center', gap: 10, padding: '16px 0', borderTop: index ? '1px solid #e6ebe8' : 'none', fontSize: 14}}>
            <b>{row[0]}</b><span>{row[1]}</span><span style={{color: C.muted}}>{row[2]}</span><span style={{padding: '8px 10px', borderRadius: 8, border: '1px solid #b8cec3', color: C.forest, textAlign: 'center', fontWeight: 800}}>キャディを決める</span>
          </div>
        ))}
      </Card>
      <Card tint={C.mint}>
        <div style={{fontSize: 17, fontWeight: 850}}>配置を試す</div>
        <div style={{marginTop: 18, padding: 16, borderRadius: 12, background: C.white}}><div style={{fontSize: 13, color: C.muted}}>08:10 サンプル組A</div><div style={{fontSize: 18, fontWeight: 850, marginTop: 7}}>サンプルキャディA</div><div style={{fontSize: 13, color: C.green, marginTop: 7}}>評価・経験・空き時間を確認</div></div>
        <div style={{marginTop: 12, padding: 13, borderRadius: 10, background: C.forest, color: C.white, textAlign: 'center', fontSize: 14, fontWeight: 850}}>この配置で確定</div>
      </Card>
    </div>
  </div>
);

const CaddieDemandScreen = () => {
  const frame = useCurrentFrame();
  const rows = [
    {course: '東コース', need: 8, assigned: 6, color: C.orange},
    {course: '西コース', need: 6, assigned: 6, color: C.green},
    {course: '南コース', need: 4, assigned: 5, color: C.lime},
  ];
  return (
    <div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14}}>
        {[
          ['キャディ付き予約', '18組'],
          ['出勤予定', '17名'],
          ['確認が必要', '2枠'],
        ].map(([label, value], index) => (
          <Card key={label} tint={index === 2 ? '#fff4e8' : C.white}>
            <div style={{fontSize: 14, color: C.muted}}>{label}</div>
            <div style={{fontSize: 32, fontWeight: 850, color: index === 2 ? C.orange : C.forest, marginTop: 8}}>{value}</div>
          </Card>
        ))}
      </div>
      <Card tint="#fbfcfb">
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div style={{fontSize: 18, fontWeight: 850}}>時間帯ごとの需給</div>
          <div style={{fontSize: 13, color: C.muted}}>必要人数と出勤予定を比較・サンプル表示</div>
        </div>
        {rows.map((row, index) => {
          const p = spring({frame: frame - index * 4, fps: 30, durationInFrames: 16, config: {damping: 200}});
          const gap = row.assigned - row.need;
          return (
            <div key={row.course} style={{display: 'grid', gridTemplateColumns: '125px 1fr 120px', alignItems: 'center', gap: 18, padding: '22px 0', borderTop: index ? '1px solid #e6ebe8' : 'none'}}>
              <b style={{fontSize: 16}}>{row.course}</b>
              <div>
                <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 13, color: C.muted, marginBottom: 8}}><span>必要 {row.need}名</span><span>出勤 {row.assigned}名</span></div>
                <div style={{height: 14, borderRadius: 99, background: '#e7ece9', overflow: 'hidden'}}><div style={{height: '100%', width: `${Math.min(100, (row.assigned / row.need) * 100) * p}%`, borderRadius: 99, background: row.color}} /></div>
              </div>
              <span style={{padding: '9px 10px', borderRadius: 99, textAlign: 'center', background: gap < 0 ? '#fff0df' : C.mint, color: gap < 0 ? '#a65e25' : C.forest, fontSize: 13, fontWeight: 850}}>{gap < 0 ? `不足 ${Math.abs(gap)}名` : gap > 0 ? `余力 ${gap}名` : '充足'}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
};

const DutiesScreen = () => (
  <div>
    <div style={{display: 'flex', gap: 8, marginBottom: 16}}>
      <span style={{padding: '10px 18px', borderRadius: 10, background: '#edf2ef', color: C.muted, fontSize: 14}}>ラウンド配置</span>
      <span style={{padding: '10px 18px', borderRadius: 10, background: C.forest, color: C.white, fontSize: 14, fontWeight: 850}}>別業務</span>
    </div>
    <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16}}>
      <Card tint="#fbfcfb">
        <div style={{fontSize: 17, fontWeight: 850}}>本日の別業務</div>
        {[
          ['07:00–09:00', 'コース整備', 'サンプルA'],
          ['10:00–12:00', 'ポーター補助', 'サンプルB'],
          ['終日', '新人研修', 'サンプルC'],
        ].map((row, index) => (
          <Pop key={row[1]} delay={index * 3}>
            <div style={{display: 'grid', gridTemplateColumns: '120px 1fr 110px', padding: '18px 0', borderTop: index ? '1px solid #e5eae7' : 'none', fontSize: 14}}>
              <b style={{color: C.forest}}>{row[0]}</b><span>{row[1]}</span><span style={{color: C.muted}}>{row[2]}</span>
            </div>
          </Pop>
        ))}
      </Card>
      <Card tint={C.mint}>
        <div style={{fontSize: 17, fontWeight: 850}}>重なりをその場で確認</div>
        <div style={{marginTop: 24, padding: 18, borderRadius: 12, background: C.white}}>
          <div style={{fontSize: 13, color: C.muted}}>サンプルキャディB</div>
          <div style={{fontSize: 19, fontWeight: 850, marginTop: 7}}>12:20 西コースへ配置可能</div>
        </div>
        <div style={{marginTop: 14, padding: 18, borderRadius: 12, background: '#fff2e4', color: '#95541f'}}>
          <div style={{fontSize: 13}}>サンプルキャディC</div>
          <div style={{fontSize: 18, fontWeight: 850, marginTop: 7}}>終日研修のため配置対象外</div>
        </div>
      </Card>
    </div>
  </div>
);

const AttendancePayrollScreen = () => (
  <div style={{display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 16}}>
    <Card>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}><div style={{fontSize: 18, fontWeight: 850}}>出勤のボード</div><span style={{fontSize: 13, color: C.muted}}>今日の割当と比較</span></div>
      {[
        ['サンプルA', '今日 2組', '勤務中'],
        ['サンプルB', '今日 1組', '勤務中'],
        ['サンプルC', '別業務', 'まだ出勤していない'],
        ['サンプルD', '今日 2組', '退勤済み'],
      ].map((row, index) => (
        <div key={row[0]} style={{display: 'grid', gridTemplateColumns: '1fr 85px 132px', alignItems: 'center', padding: '16px 0', borderTop: index ? '1px solid #e6ebe8' : 'none', fontSize: 14}}>
          <b>{row[0]}</b><span style={{color: C.muted}}>{row[1]}</span><span style={{padding: '7px 7px', borderRadius: 99, textAlign: 'center', background: row[2] === 'まだ出勤していない' ? '#fff0df' : C.mint, color: row[2] === 'まだ出勤していない' ? '#a65e25' : C.forest, fontSize: row[2] === 'まだ出勤していない' ? 11 : 14, fontWeight: 800}}>{row[2]}</span>
        </div>
      ))}
    </Card>
    <Card tint="#fbfcfb">
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}><div style={{fontSize: 18, fontWeight: 850}}>給与への受け渡し</div><span style={{fontSize: 13, color: C.muted}}>2026年8月</span></div>
      {[
        ['サンプルA', 'A / 2組', '確認済み'],
        ['サンプルB', 'B / 1組', '確認済み'],
        ['サンプルC', '研修 1日', '要確認'],
      ].map((row, index) => (
        <div key={row[0]} style={{padding: '17px 0', borderTop: index ? '1px solid #e6ebe8' : 'none'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 14}}><b>{row[0]}</b><span style={{color: row[2] === '要確認' ? C.orange : C.green, fontWeight: 800}}>{row[2]}</span></div>
          <div style={{fontSize: 13, color: C.muted, marginTop: 7}}>ランク・担当　{row[1]}</div>
        </div>
      ))}
      <div style={{marginTop: 14, padding: 13, borderRadius: 10, background: C.forest, color: C.white, textAlign: 'center', fontSize: 14, fontWeight: 850}}>CSVを出す</div>
    </Card>
  </div>
);

const ReceptionScreen = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const scan = interpolate(frame, [0, 2.5 * fps], [20, 420], CLAMP);
  return (
    <div style={{display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: 18}}>
      <Card tint="#f4f1e8">
        <div style={{fontSize: 17, fontWeight: 800}}>受付用紙</div>
        <div style={{position: 'relative', height: 430, marginTop: 14, borderRadius: 10, background: C.white, border: '1px solid #d7d5ce', padding: 22, boxSizing: 'border-box'}}>
          {['お名前', 'ふりがな', '電話番号', 'ご住所', 'ご案内の確認'].map((label, i) => (
            <div key={label} style={{fontSize: 13, color: '#858983', marginTop: i ? 30 : 0}}>{label}<div style={{height: 1, background: '#cfd5d0', marginTop: 12}} /></div>
          ))}
          <div style={{position: 'absolute', left: 0, right: 0, top: scan, height: 3, background: C.lime, boxShadow: `0 0 18px ${C.lime}`}} />
        </div>
      </Card>
      <Card>
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
          <div style={{fontSize: 18, fontWeight: 800}}>読み取り候補を確認</div>
          <span style={{padding: '7px 12px', borderRadius: 99, background: C.mint, color: C.forest, fontSize: 13}}>読み取り下書き</span>
        </div>
        {[
          ['氏名', 'サンプル顧客 A'],
          ['ふりがな', 'さんぷる こきゃく'],
          ['電話番号', '000-0000-0000'],
          ['住所', 'デモ市 1-2-3'],
        ].map(([label, value], i) => (
          <Pop key={label} delay={10 + i * 3}>
            <div style={{marginTop: 16}}><div style={{fontSize: 13, color: C.muted}}>{label}</div><div style={{marginTop: 6, padding: '12px 14px', borderRadius: 10, border: '1px solid #dce2de', fontSize: 15}}>{value}</div></div>
          </Pop>
        ))}
        <div style={{marginTop: 20, padding: '13px', borderRadius: 10, textAlign: 'center', background: C.forest, color: C.white, fontSize: 15, fontWeight: 800}}>この人を登録する</div>
      </Card>
    </div>
  );
};

const CustomerScreen = () => (
  <div style={{display: 'grid', gridTemplateColumns: '1fr 1.05fr', gap: 18}}>
    <Card>
      <div style={{padding: '12px 14px', border: '1px solid #dce2de', borderRadius: 10, color: C.muted, fontSize: 14}}>名前・会員番号でさがす</div>
      {[
        ['サンプル顧客 A', '会員', '最終来場 8/18'],
        ['デモ顧客 B', 'ビジター', '最終来場 8/12'],
        ['テスト顧客 C', '会員', '最終来場 7/28'],
        ['サンプル顧客 D', '会員', '最終来場 7/14'],
      ].map((row, i) => (
        <div key={row[0]} style={{padding: '16px 4px', borderTop: '1px solid #edf0ee', display: 'grid', gridTemplateColumns: '1fr 90px 130px', fontSize: 14, background: i === 0 ? '#f0f8f4' : C.white}}>
          <b>{row[0]}</b><span style={{color: C.green}}>{row[1]}</span><span style={{color: C.muted}}>{row[2]}</span>
        </div>
      ))}
    </Card>
    <Card tint="#fbfcfb">
      <div style={{display: 'flex', justifyContent: 'space-between'}}><div style={{fontSize: 22, fontWeight: 850}}>サンプル顧客 A</div><span style={{fontSize: 13, padding: '6px 10px', borderRadius: 99, background: C.mint, color: C.forest}}>会員</span></div>
      <div style={{fontSize: 14, color: C.muted, marginTop: 8}}>会員番号 DEMO-001</div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginTop: 22}}>
        {[['来場', '12回'], ['予約', '2件'], ['平均人数', '3.4人']].map(([label, value]) => <Card key={label} tint={C.white}><div style={{fontSize: 12, color: C.muted}}>{label}</div><div style={{fontSize: 22, fontWeight: 850, marginTop: 6}}>{value}</div></Card>)}
      </div>
      <div style={{fontSize: 16, fontWeight: 800, marginTop: 22}}>最近の来場</div>
      {['8月18日　東コース　3名', '7月29日　西コース　4名', '6月12日　東コース　3名'].map((text) => <div key={text} style={{fontSize: 14, padding: '13px 0', borderBottom: '1px solid #e6ebe8'}}>{text}</div>)}
    </Card>
  </div>
);

const ShiftScreen = () => {
  const rows = [
    ['サンプルA', '', '出', '出', '', '休', '', '出'],
    ['サンプルB', '出', '出', '', '出', '出', '', '休'],
    ['サンプルC', '', '休', '', '出', '出', '出', ''],
    ['サンプルD', '出', '', '出', '出', '', '', '休'],
    ['サンプルE', '', '出', '', '休', '', '出', '出'],
  ];
  return (
    <div>
      <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 14, color: C.muted}}><span>2026年 8月</span><span>● 出勤予定　<span style={{color: C.orange}}>● 休み希望</span></span></div>
      <div style={{display: 'grid', gridTemplateColumns: '170px repeat(7,1fr)', marginTop: 18, border: '1px solid #dfe5e1', borderRadius: 12, overflow: 'hidden'}}>
        {['キャディ', '5 火', '6 水', '7 木', '8 金', '9 土', '10 日', '11 月'].map((h) => <div key={h} style={{padding: 16, background: '#f2f6f3', fontSize: 14, fontWeight: 800, textAlign: h === 'キャディ' ? 'left' : 'center'}}>{h}</div>)}
        {rows.flatMap((row) => row.map((v, i) => <div key={`${row[0]}-${i}`} style={{padding: 18, borderTop: '1px solid #e4e9e6', borderLeft: i ? '1px solid #e4e9e6' : 'none', background: v === '出' ? C.mint : v === '休' ? '#fbe9d4' : C.white, color: v === '休' ? '#a75e25' : C.forest, fontSize: 15, fontWeight: 800, textAlign: i ? 'center' : 'left'}}>{v}</div>))}
      </div>
    </div>
  );
};

const Intro = () => {
  const frame = useCurrentFrame();
  const p = spring({frame, fps: 30, durationInFrames: 16, config: {damping: 18, stiffness: 220}});
  return (
    <AbsoluteFill style={{fontFamily: FONT, background: `linear-gradient(135deg,${C.forest},#071b1a)`, color: C.white, overflow: 'hidden'}}>
      <div style={{position: 'absolute', right: -120, top: -250, width: 820, height: 820, borderRadius: '50%', background: 'radial-gradient(circle,rgba(184,229,93,.35),transparent 65%)', transform: `scale(${p})`}} />
      <div style={{position: 'absolute', left: 100, top: 70}}><Logo light /></div>
      <div style={{position: 'absolute', left: 100, top: 365}}>
        <Pop delay={3}><div style={{fontSize: 24, color: C.lime, letterSpacing: '.12em', fontWeight: 800}}>GOLF CLUB OPERATIONS, CONNECTED</div></Pop>
        <div style={{height: 20}} />
        <Pop delay={7}><div style={{fontSize: 78, lineHeight: 1.15, fontWeight: 850, letterSpacing: '-.055em'}}>受付から顧客管理まで、<br />現場の仕事をひとつに。</div></Pop>
        <Pop delay={12}><div style={{fontSize: 28, color: '#cfe2da', marginTop: 26}}>受付、キャディ、予約、顧客管理。</div></Pop>
      </div>
    </AbsoluteFill>
  );
};

const Outro = () => (
  <AbsoluteFill style={{fontFamily: FONT, background: `linear-gradient(145deg,${C.cream},#dff3e9)`, alignItems: 'center', justifyContent: 'center'}}>
    <Pop delay={2}><div style={{display: 'flex', gap: 18, alignItems: 'center', fontSize: 21, color: C.forest, fontWeight: 800}}>{['受付','キャディ','予約','顧客管理'].map((x, i) => <div key={x} style={{display: 'flex', gap: 18, alignItems: 'center'}}><span style={{padding: '14px 24px', background: C.white, borderRadius: 99, boxShadow: '0 12px 30px rgba(23,77,58,.08)'}}>{x}</span>{i < 3 && <span>→</span>}</div>)}</div></Pop>
    <div style={{height: 52}} />
    <Pop delay={8}><div style={{fontSize: 72, lineHeight: 1.2, textAlign: 'center', color: C.ink, fontWeight: 850, letterSpacing: '-.055em'}}>ゴルフ場の仕事に合わせた、<br />運用画面。</div></Pop>
    <div style={{height: 42}} />
    <Pop delay={14}><Logo width={300} /></Pop>
  </AbsoluteFill>
);

const T = linearTiming({durationInFrames: 6});

export const CourseBoardPromoRapid = () => (
  <AbsoluteFill style={{background: C.ink}}>
    <Audio src={staticFile('audio/courseboard-promo-bed.wav')} volume={(f) => interpolate(f, [0, 24, 852, 899], [0, 0.75, 0.75, 0], CLAMP)} />
    <TransitionSeries>
      <TransitionSeries.Sequence durationInFrames={48} premountFor={20}><Intro /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />
      <TransitionSeries.Sequence durationInFrames={24} premountFor={12}><SectionDivider theme={SECTION_THEMES.reception} number="01" /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={88} premountFor={20}><FeatureScene theme={SECTION_THEMES.reception} number="01" kicker="受付から台帳へ" title={'紙を読み取り、\n顧客につなぐ。'} body="候補を直して確かめてから、顧客台帳へ登録。" active="受付・顧客" screenTitle="受付用紙から顧客を登録"><ReceptionScreen /></FeatureScene></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-bottom'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={24} premountFor={12}><SectionDivider theme={SECTION_THEMES.caddie} number="02" /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={88} premountFor={20}><FeatureScene theme={SECTION_THEMES.caddie} number="02" kicker="先に不足を知る" title={'予約と出勤から、\n需給をつかむ。'} body="必要人数と出勤予定を比べ、足りない時間帯を早めに確認。" active="キャディ需給" screenTitle="キャディ需給"><CaddieDemandScreen /></FeatureScene></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-bottom'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={88} premountFor={20}><FeatureScene theme={SECTION_THEMES.caddie} number="03" kicker="担当を決める" title={'組とキャディを、\nすばやく配置。'} body="未配置と空き状況を見ながら、その場で担当を確定。" active="ラウンド配置" screenTitle="ラウンド配置"><DispatchScreen /></FeatureScene></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={88} premountFor={20}><FeatureScene theme={SECTION_THEMES.caddie} number="04" kicker="ラウンド以外も" title={'別業務まで、\n重ねて見る。'} body="整備、補助、研修をラウンド配置と分けて管理。" active="別業務" screenTitle="別業務"><DutiesScreen /></FeatureScene></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-bottom'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={88} premountFor={20}><FeatureScene theme={SECTION_THEMES.caddie} number="05" kicker="先まで見通す" title={'ひと月のシフトを、\nひと目で。'} body="出勤予定と休み希望を重ね、偏りを早めに確認。" active="シフト表" screenTitle="シフト表"><ShiftScreen /></FeatureScene></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={88} premountFor={20}><FeatureScene theme={SECTION_THEMES.caddie} number="06" kicker="実績をつなぐ" title={'出勤から給与へ、\n確認をつなぐ。'} body="当日の打刻と担当実績を見比べ、月次の受け渡しへ。" active="出勤・給与" screenTitle="出勤と給与"><AttendancePayrollScreen /></FeatureScene></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />
      <TransitionSeries.Sequence durationInFrames={24} premountFor={12}><SectionDivider theme={SECTION_THEMES.reservation} number="03" /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={88} premountFor={20}><FeatureScene theme={SECTION_THEMES.reservation} number="07" kicker="予約を起点に" title={'一日の流れを、\n時間で見る。'} body="コースとスタート時刻を見渡し、必要なキャディ数へ。" active="予約台帳" screenTitle="今日のタイムライン"><TimelineScreen /></FeatureScene></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />
      <TransitionSeries.Sequence durationInFrames={24} premountFor={12}><SectionDivider theme={SECTION_THEMES.customer} number="04" /></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={slide({direction: 'from-right'})} timing={T} />
      <TransitionSeries.Sequence durationInFrames={122} premountFor={20}><FeatureScene theme={SECTION_THEMES.customer} number="08" kicker="来場を次へ活かす" title={'顧客の履歴を、\n次の予約へ。'} body="来場、予約、会員情報をひとつの顧客台帳で確認。" active="顧客台帳" screenTitle="顧客台帳"><CustomerScreen /></FeatureScene></TransitionSeries.Sequence>
      <TransitionSeries.Transition presentation={fade()} timing={T} />
      <TransitionSeries.Sequence durationInFrames={96} premountFor={20}><Outro /></TransitionSeries.Sequence>
    </TransitionSeries>
  </AbsoluteFill>
);

export const CourseBoardPromoRapidPoster = () => (
  <AbsoluteFill style={{fontFamily: FONT, background: `linear-gradient(135deg,${C.forest},#071b1a)`, color: C.white, padding: 100}}>
    <Logo light />
    <div style={{marginTop: 180, fontSize: 25, color: C.lime, letterSpacing: '.12em', fontWeight: 800}}>GOLF CLUB OPERATIONS, CONNECTED</div>
    <div style={{marginTop: 24, fontSize: 82, lineHeight: 1.15, fontWeight: 850, letterSpacing: '-.055em'}}>受付から顧客管理まで、<br />現場の仕事をひとつに。</div>
    <div style={{marginTop: 30, fontSize: 30, color: '#cfe2da'}}>受付、キャディ、予約、顧客管理。</div>
  </AbsoluteFill>
);
