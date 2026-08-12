# 프론트엔드 디자인 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 디자인 토큰 체계와 UI 프리미티브를 세우고 전 화면을 거기에 맞춰 재조율해, 모바일에서도 성립하는 베타 배포 가능한 프론트엔드를 만든다.

**Architecture:** 3층으로 쌓는다. ①`tailwind.config.ts`/`globals.css`의 토큰(색 14 · 타입 7단 · 반경 4단), ②그 토큰만 사용하는 `components/ui/` 프리미티브 10종, ③프리미티브로 조립한 화면들. 앱 셸(`AppShell`)이 768px를 경계로 데스크톱 좌측 레일과 모바일 하단 탭바를 분기하며, 레일을 고정 오버레이가 아닌 레이아웃 컬럼으로 확보해 기존 클릭 차단 버그를 구조적으로 없앤다.

**Tech Stack:** Next.js 14.2.35 (App Router) · React 18 · TypeScript strict · TailwindCSS 3.4 · framer-motion 12

---

## Global Constraints

프로젝트 전역 제약. **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- **작업 브랜치**: `feature/roadmap-sns`. `main`은 보호됨.
- **백엔드 무변경**: `backend/` 아래 파일을 수정하지 않는다. API 계약도 바꾸지 않는다.
- **`npm install` 금지**: CLAUDE.md Hard Rule. 새 패키지를 추가하지 않는다. `clsx`/`tailwind-merge`가 필요하면 직접 구현한다(Task 2에서 `lib/cn.ts` 제공).
- **TypeScript strict, `any` 금지**: CLAUDE.md 코딩 표준.
- **커밋 메시지는 Conventional Commits + 영어**: `feat:`/`fix:`/`refactor:`/`docs:`/`style:`. 본문 마지막 줄에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **사용자 대면 문구는 한국어**, 코드·주석·커밋은 영어.
- **`next build` 전에 dev 서버를 반드시 내릴 것.** 켜둔 채 빌드하면 `.next`를 덮어써 CSS 404가 발생한다. 빌드 후 `.next` 삭제 + 재기동이 안전하다.
- **프론트엔드에 테스트 러너가 없다** (`package.json`에 jest/vitest 없음). 따라서 이 계획의 검증 사이클은 **타입 검사 + 린트 + 빌드 + 스크린샷 매트릭스**다. 단위 테스트를 새로 도입하려면 `npm install`이 필요하므로 별도 승인이 필요하다.

### 검증 사이클 (모든 태스크 공통)

작업 디렉터리는 `frontend/`. 각 태스크의 "검증" 단계에서 실행한다.

```bash
cd frontend
npx tsc --noEmit          # 타입 에러 0
npm run lint              # 린트 에러 0
npm run build             # dev 서버를 내린 뒤 실행할 것
```

화면을 건드리는 태스크(Task 3 이후)는 추가로 **스크린샷 매트릭스**를 찍는다.
chrome-devtools MCP로 **390px(iPhone) / 768px / 1280px** 3종 뷰포트에서 해당 화면을 캡처하고,
가로 스크롤 발생 여부와 요소 겹침을 육안 확인한다.

### 금지 패턴 (전 태스크)

Task 1 이후 새로 작성하는 코드에서 아래를 쓰지 않는다.

| 금지 | 대신 |
|---|---|
| `rgba(...)` 직접 표기 | `border-line`, `bg-surface-raised` 등 토큰 |
| `text-[12.5px]` 등 임의 폰트 크기 | `text-body`, `text-caption` 등 7단 스케일 |
| `rounded-[18px]` 등 임의 반경 | `rounded-md`, `rounded-lg` 등 4단 |
| `ml-[230px]`, `w-[640px]` 등 고정 레이아웃 폭 | `AppShell`이 제공하는 컨테이너 |
| UI 크롬에 이모지 | `components/ui/icons.tsx`의 SVG |

### 색 매핑표 (기존 → 신규 토큰)

전 화면 이식 시 이 표를 기준으로 치환한다.

| 기존 표기 | 신규 토큰 |
|---|---|
| `bg-bean-900`, `#06120a` | `bg-earth-base` |
| `rgba(14,33,20,.55)`, `rgba(8,20,12,.85)` 카드 배경 | `bg-surface-raised` |
| `rgba(6,18,10,.74)` 내비/모달 배경 | `bg-surface-overlay` |
| `rgba(143,220,138,.13)` / `.18` / `.22` 테두리 | `border-line` |
| `rgba(143,220,138,.4)` / `.45` 강조 테두리 | `border-line-strong` |
| `rgba(143,220,138,.16)` 활성 배경 | `bg-goal/15` (활성 상태는 파랑으로 이동) |
| `text-moss-100` | `text-content-primary` |
| `text-moss-400`, `text-moss-500` | `text-content-secondary` |
| `text-moss-600`, `text-moss-700` | `text-content-muted` |
| `text-bean-200`, `#8fdc8a` 진행률 | `text-growth-bright` |
| `text-wither-300` | `text-wither` |
| `bloom-500` | `text-bloom` / `bg-bloom` |

**의미 전환 하나**: 기존에 초록으로 표시하던 **활성 탭 · 주요 버튼 · 링크 · 포커스**는 `goal`(파랑)로 옮긴다. 초록은 **진행·성장·콩나무**에만 남긴다. 이것이 설계의 핵심(`growth`=지금의 나 / `goal`=도달할 목표)이며, 단순 색 치환이 아니라 **역할 재배치**다.

---

## File Structure

### 신규 생성

| 파일 | 책임 |
|---|---|
| `frontend/lib/cn.ts` | className 결합 유틸 (외부 패키지 대체) |
| `frontend/components/ui/icons.tsx` | SVG 아이콘 한 벌 |
| `frontend/components/ui/Button.tsx` | 버튼 4변형 |
| `frontend/components/ui/Chip.tsx` | 알약 라벨/토글 |
| `frontend/components/ui/Card.tsx` | 표면 컨테이너 |
| `frontend/components/ui/Field.tsx` | 입력 + 라벨 + 에러 |
| `frontend/components/ui/Modal.tsx` | 모달 셸 (Esc·백드롭·스크롤락) |
| `frontend/components/ui/ProgressBar.tsx` | 진행률 바 |
| `frontend/components/ui/Avatar.tsx` | 이모지 아바타 + 이름 |
| `frontend/components/ui/Tabs.tsx` | 탭 전환 |
| `frontend/components/ui/EmptyState.tsx` | 빈 상태 |
| `frontend/components/ui/index.ts` | 배럴 익스포트 |
| `frontend/components/shell/AppShell.tsx` | 레일↔탭바 분기 + 컨테이너 |
| `frontend/components/shell/SideRail.tsx` | 데스크톱 좌측 내비 |
| `frontend/components/shell/TabBar.tsx` | 모바일 하단 내비 |
| `frontend/components/shell/nav-items.ts` | 내비 항목 단일 정의 (레일·탭바 공유) |

### 수정

| 파일 | 변경 |
|---|---|
| `frontend/tailwind.config.ts` | 토큰 정의로 교체 |
| `frontend/app/globals.css` | 배경·기본 폰트·포커스 링 |
| `frontend/app/layout.tsx` | `SideNav` → `AppShell`, viewport 메타 |
| `frontend/app/page.tsx` 외 전 페이지 | 프리미티브로 이식 |
| `frontend/components/*.tsx` (기존 10개) | 토큰·프리미티브 적용 |

### 삭제

| 파일 | 사유 |
|---|---|
| `frontend/components/SideNav.tsx` | `components/shell/SideRail.tsx`가 대체 |

---

## Task 0: 작업 준비

**Files:**
- Modify: `03_Code/.gitignore`

**Interfaces:**
- Consumes: 없음
- Produces: 깨끗한 작업 트리

- [ ] **Step 1: 브랜치와 작업 트리 확인**

```bash
cd C:/Users/user/Project_CareerCompass/03_Code
git branch --show-current    # feature/roadmap-sns 여야 함
git status --short
```

Expected: `feature/roadmap-sns`. `frontend/.claude/`가 미추적 상태로 뜨는데, 이건 에디터 설정 폴더다.

- [ ] **Step 2: `frontend/.claude/`를 gitignore에 추가**

`03_Code/.gitignore` 끝에 추가:

```
# editor-local agent config
frontend/.claude/
```

- [ ] **Step 3: dev 서버가 떠 있으면 내리기**

```bash
netstat -ano | grep :3000
```

떠 있으면 해당 PID를 `taskkill //F //PID <pid>`로 종료한다. **이후 모든 `next build` 전에 이 확인을 반복한다.**

- [ ] **Step 4: 커밋**

```bash
git add .gitignore
git commit -m "chore: ignore editor-local frontend agent config

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 1: 디자인 토큰

화면 변화 없이 토큰만 **추가**한다. 기존 `bean`/`moss` 팔레트는 이 단계에서 지우지 않는다 — 아직 전 화면이 그걸 쓰고 있으므로 지우면 빌드가 깨진다. Task 4f 완료 후 Task 5에서 제거한다.

**Files:**
- Modify: `frontend/tailwind.config.ts`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Produces: Tailwind 클래스 `bg-earth-base` `bg-sky-base` `bg-surface-raised` `bg-surface-overlay` `text-content-primary|secondary|muted` `text-growth|growth-bright` `text-goal|goal-bright` `text-bloom` `text-wither` `border-line|line-strong` / `text-display|title|heading|body|body-sm|caption|micro` / `rounded-sm|md|lg|xl` / `bg-altitude` / `h-tabbar` `w-rail`

- [ ] **Step 1: `tailwind.config.ts` 교체**

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // --- Surface: altitude-based backgrounds ---
        sky: { base: "#0B1E3D", mid: "#0E2438" },
        earth: { base: "#06120A", mid: "#0D2119" },
        surface: {
          raised: "rgba(10,28,42,.55)",
          overlay: "rgba(6,16,12,.86)",
        },
        // --- Content: text ramp that works on both navy and forest ---
        content: {
          primary: "#EAF3EE",
          secondary: "#9FB6AD",
          muted: "#7D968C",
        },
        // --- Accent: colours that carry meaning ---
        // growth = where the user is now; goal = where they are heading
        growth: { DEFAULT: "#5DB35B", bright: "#8FDC8A", dim: "#2C5B36" },
        goal: { DEFAULT: "#2F6FBF", bright: "#7CC4F0", dim: "#173A5E" },
        bloom: { DEFAULT: "#E2B94F" },
        wither: { DEFAULT: "#D8B078", dim: "#5A4527" },
        // --- Line: replaces 91 hand-written rgba borders ---
        line: {
          DEFAULT: "rgba(140,180,220,.17)",
          strong: "rgba(140,180,220,.34)",
        },
        // Legacy palettes stay until Task 5 removes their last usage.
        bean: {
          950: "#050e07", 900: "#06120a", 850: "#081a0e", 800: "#0e2013",
          750: "#132a18", 700: "#173420", 650: "#1c3a24", 600: "#2c5b36",
          550: "#2a6134", 500: "#3f8f47", 400: "#5db35b", 300: "#6abf63",
          200: "#8fdc8a", 100: "#b9eab2",
        },
        moss: {
          50: "#f2f7ee", 100: "#eaf5e6", 300: "#c8ecc2", 400: "#a9c3aa",
          500: "#8aa78d", 600: "#7fae83", 700: "#6f8f74",
        },
        night: { 300: "#9db8c9", 700: "#152a3d", 800: "#233a52" },
      },
      fontSize: {
        display: ["1.875rem", { lineHeight: "1.3" }],      // 30px
        title: ["1.25rem", { lineHeight: "1.35" }],        // 20px
        heading: ["1.0625rem", { lineHeight: "1.4" }],     // 17px
        body: ["0.9375rem", { lineHeight: "1.65" }],       // 15px
        "body-sm": ["0.84375rem", { lineHeight: "1.6" }],  // 13.5px
        caption: ["0.75rem", { lineHeight: "1.5" }],       // 12px
        micro: ["0.65625rem", { lineHeight: "1.45" }],     // 10.5px
      },
      borderRadius: { sm: "8px", md: "12px", lg: "16px", xl: "20px" },
      backgroundImage: {
        altitude:
          "linear-gradient(180deg,#0B1E3D 0%,#0E2438 30%,#0D2119 68%,#06120A 100%)",
      },
      spacing: {
        tabbar: "58px",
        rail: "196px",
      },
      fontFamily: {
        sans: ["var(--font-plex)", "sans-serif"],
        serif: ["var(--font-gowun)", "serif"],
      },
    },
  },
  plugins: [],
};
export default config;
```

> 주의: `sky`는 Tailwind 기본 팔레트 이름과 겹친다. 의도적으로 덮어쓰는 것이며, 기존 코드에서 기본 sky 색을 쓰는 곳이 없음을 Step 3에서 확인한다.

- [ ] **Step 2: `globals.css` 상단 블록 교체**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #06120a;
  --foreground: #eaf3ee;
  /* consumed by AppShell so canvas pages can reserve tab-bar space */
  --tabbar-h: 58px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}

html,
body {
  height: 100%;
  background: var(--background);
}

body {
  color: var(--foreground);
  font-family: var(--font-plex), sans-serif;
  font-size: 0.9375rem; /* body token: 15px, was an implicit 12.5px */
  line-height: 1.65;
  word-break: keep-all;
  -webkit-font-smoothing: antialiased;
}

/* Links inherit the goal accent: blue means "where you are heading". */
a {
  color: #7cc4f0;
}
a:hover {
  color: #a5d8f7;
}

/* One visible focus treatment everywhere, keyboard only. */
:focus-visible {
  outline: 2px solid #7cc4f0;
  outline-offset: 2px;
  border-radius: 4px;
}

::-webkit-scrollbar {
  width: 10px;
}
::-webkit-scrollbar-thumb {
  background: rgba(140, 180, 220, 0.22);
  border-radius: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
```

**아래의 기존 `@keyframes` 정의(`drawBranch`, `sprout`, `twinkle`, `floaty`, `sway`, `glowPulse`, `blink`, `celebratePop`, `confettiFly`, `cheerRing`, `celebrateText`)는 한 줄도 지우지 말고 그대로 둔다.** 지우면 `BeanstalkCanvas`와 축하 연출이 깨진다.

- [ ] **Step 3: 기본 sky 팔레트 사용처가 없는지 확인**

```bash
cd frontend
grep -rnE '(text|bg|border)-sky-[0-9]' app components
```

Expected: 결과 없음. 있으면 해당 위치를 `night` 또는 신규 `sky-base/mid`로 바꾼다.

- [ ] **Step 4: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: 전부 통과. 화면은 body 폰트가 커진 것 외에 거의 그대로여야 한다(기존 팔레트를 남겨뒀으므로).

- [ ] **Step 5: 커밋**

```bash
git add frontend/tailwind.config.ts frontend/app/globals.css
git commit -m "feat(design): add altitude design tokens

Defines 14 colour tokens, a 7-step type scale, a 4-step radius scale and
the shared altitude gradient. Legacy bean/moss palettes stay until the
last screen stops using them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: UI 프리미티브

아직 어떤 화면도 이 컴포넌트들을 쓰지 않는다. **회귀 위험 0.**

**Files:**
- Create: `frontend/lib/cn.ts`, `frontend/components/ui/{icons,Button,Chip,Card,Field,Modal,ProgressBar,Avatar,Tabs,EmptyState}.tsx`, `frontend/components/ui/index.ts`

**Interfaces:**
- Consumes: Task 1의 토큰 클래스
- Produces: 아래 시그니처들. **이후 모든 태스크가 이 이름과 타입에 의존한다.**

```ts
cn(...classes: (string | false | null | undefined)[]): string

Button:      { variant?: "primary"|"secondary"|"ghost"|"danger"; size?: "sm"|"md"; fullWidth?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>
Chip:        { children: ReactNode; tone?: "goal"|"growth"|"bloom"|"wither"|"neutral"; selected?: boolean; interactive?: boolean; onClick?: () => void; title?: string; className?: string }
Card:        { interactive?: boolean } & HTMLAttributes<HTMLDivElement>
Field:       { id: string; label: string; error?: string | null; hint?: string; className?: string; multiline?: boolean } & input/textarea attrs
Modal:       { open: boolean; onClose: () => void; title?: string; size?: "sm"|"md"|"lg"; children: ReactNode }
ProgressBar: { value: number; tone?: "growth"|"altitude"; className?: string }
Avatar:      { emoji: string; name?: string; size?: "sm"|"md"; onClick?: () => void }
Tabs:        <T extends string>{ items: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }
EmptyState:  { title: string; description?: string; action?: ReactNode }
Icons:       SproutIcon ForestIcon SeedIcon BeanIcon CalendarIcon TargetIcon WitherIcon KeyIcon
             CheckIcon CloseIcon ChevronRightIcon PlusIcon EagleIcon
             — all accept { size?: number; className?: string }
```

- [ ] **Step 1: `lib/cn.ts` 작성**

```ts
/** Join class names, dropping falsy entries. Replaces clsx (no new deps). */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
```

- [ ] **Step 2: `components/ui/icons.tsx` 작성**

기존 `SideNav.tsx`의 5개 아이콘을 그대로 옮기고 7개를 추가한다. 모두 `currentColor`, 기본 18px.

```tsx
import type { ReactNode } from "react";

type IconProps = { size?: number; className?: string };

function svg(size: number, className: string | undefined, children: ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export function SproutIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <>
      <path d="M12 22V10.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 12.5C12 9 9 7 5 7C5 10.5 8 12.5 12 12.5Z" fill="currentColor" />
      <path d="M12 10C12 7 14.5 5 18 5C18 8.5 15.5 10 12 10Z" fill="currentColor" />
    </>
  ));
}

export function ForestIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <>
      <path d="M6 21v-7M12 21V8M18 21v-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="6" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="6" r="2" fill="currentColor" />
      <circle cx="18" cy="10" r="2" fill="currentColor" />
    </>
  ));
}

export function SeedIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

export function BeanIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <>
      <path d="M7 4C4 6 3.5 10.5 6 14c2.6 3.6 7.4 5.4 10.9 4C20 16.8 21 12.5 18.5 9 15.9 5.4 10 2 7 4Z" stroke="currentColor" strokeWidth="2" />
      <path d="M9 8c1.5 1 4.5 3.5 5.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

export function CalendarIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" stroke="currentColor" strokeWidth="2" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

/** Replaces the target emoji used for career goals. */
export function TargetIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <>
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </>
  ));
}

/** Replaces the wilted-flower emoji used for withered beanstalks. */
export function WitherIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <>
      <path d="M12 21v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 14c-3.5 0-5.5-2-5.5-5 3 0 5.5 1.5 5.5 5Z" fill="currentColor" opacity=".55" />
      <path d="M12 12.5c0-2.6 1.8-4.5 4.5-4.5 0 2.6-1.8 4.5-4.5 4.5Z" fill="currentColor" opacity=".35" />
    </>
  ));
}

export function KeyIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <>
      <circle cx="8" cy="12" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M12 12h9M18 12v3.5M15.5 12v2.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </>
  ));
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return svg(size, className, <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />);
}

export function CloseIcon({ size = 18, className }: IconProps) {
  return svg(size, className, <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />);
}

export function ChevronRightIcon({ size = 18, className }: IconProps) {
  return svg(size, className, <path d="M9.5 5.5L16 12l-6.5 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />);
}

export function PlusIcon({ size = 18, className }: IconProps) {
  return svg(size, className, <path d="M12 5.5v13M5.5 12h13" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />);
}

/**
 * Eagle silhouette. A motif nod to the university symbol, deliberately
 * generic: never the official crest or wordmark (trademark).
 * Used only in the night sky and at completion moments.
 */
export function EagleIcon({ size = 18, className }: IconProps) {
  return svg(size, className, (
    <path
      d="M2 9c3.2-.4 5.4.7 7 2.4V9.6c0-1 .8-1.9 1.9-1.9h2.2c1 0 1.9.8 1.9 1.9v1.8C16.6 9.7 18.8 8.6 22 9c-2.1 2.2-3.6 3.9-5.7 5.1-1.4.8-2.9 1.2-4.3 1.2s-2.9-.4-4.3-1.2C5.6 12.9 4.1 11.2 2 9Z"
      fill="currentColor"
    />
  ));
}
```

- [ ] **Step 3: `Button.tsx` 작성**

```tsx
"use client";

import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary: "bg-goal text-white hover:brightness-110 border border-transparent",
  secondary: "bg-goal/12 text-goal-bright border border-line-strong hover:bg-goal/20",
  ghost: "bg-transparent text-content-secondary border border-line hover:bg-goal/10",
  danger: "bg-transparent text-wither border border-wither/45 hover:bg-wither/12",
};

const SIZE: Record<Size, string> = {
  sm: "px-3.5 py-1.5 text-caption rounded-sm",
  md: "px-5 py-2.5 text-body-sm rounded-md",
};

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap",
        "transition-[filter,background-color,border-color] duration-150",
        "disabled:opacity-50 disabled:pointer-events-none",
        VARIANT[variant],
        SIZE[size],
        fullWidth && "w-full",
        className
      )}
      {...rest}
    />
  );
}
```

- [ ] **Step 4: `Chip.tsx` 작성**

```tsx
"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "goal" | "growth" | "bloom" | "wither" | "neutral";

export interface ChipProps {
  children: ReactNode;
  tone?: Tone;
  selected?: boolean;
  interactive?: boolean;
  onClick?: () => void;
  title?: string;
  className?: string;
}

const TONE: Record<Tone, { on: string; off: string }> = {
  goal: { on: "bg-goal/18 text-goal-bright border-line-strong", off: "text-content-muted border-line" },
  growth: { on: "bg-growth/18 text-growth-bright border-growth/45", off: "text-content-muted border-line" },
  bloom: { on: "bg-bloom/15 text-bloom border-bloom/40", off: "text-content-muted border-line" },
  wither: { on: "bg-wither/15 text-wither border-wither/40", off: "text-content-muted border-line" },
  neutral: { on: "bg-white/8 text-content-primary border-line-strong", off: "text-content-muted border-line" },
};

export function Chip({
  children, tone = "goal", selected = false, interactive = false,
  onClick, title, className,
}: ChipProps) {
  const base = cn(
    "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border",
    "px-4 py-1.5 text-caption font-semibold transition-colors",
    selected ? TONE[tone].on : TONE[tone].off,
    interactive && !selected && "hover:bg-white/6",
    className
  );

  if (interactive || onClick) {
    return (
      <button type="button" onClick={onClick} title={title} aria-pressed={selected} className={base}>
        {children}
      </button>
    );
  }
  return <span title={title} className={base}>{children}</span>;
}
```

- [ ] **Step 5: `Card.tsx` 작성**

```tsx
"use client";

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
}

export function Card({ interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-surface-raised p-4 backdrop-blur-[2px]",
        interactive &&
          "cursor-pointer transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-line-strong",
        className
      )}
      {...rest}
    />
  );
}
```

- [ ] **Step 6: `Field.tsx` 작성**

`login`/`signup`/`verify`/`reset-password` 4곳의 중복을 없앤다.

```tsx
"use client";

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Common = {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  className?: string;
};

export type FieldProps =
  | (Common & { multiline?: false } & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className">)
  | (Common & { multiline: true } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "className">);

const CONTROL =
  "w-full rounded-md border bg-black/25 px-3.5 py-2.5 text-body text-content-primary " +
  "placeholder:text-content-muted transition-colors focus:outline-none " +
  "focus-visible:border-goal-bright";

export function Field(props: FieldProps) {
  const { id, label, error, hint, className, ...rest } = props;
  const borderTone = error ? "border-wither/60" : "border-line";
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-caption font-semibold text-content-secondary">
        {label}
      </label>
      {"multiline" in props && props.multiline ? (
        <textarea
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(CONTROL, borderTone, "min-h-[96px] resize-y")}
          {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(CONTROL, borderTone)}
          {...(rest as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}
      {error ? (
        <p id={`${id}-error`} className="text-caption text-wither">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-caption text-content-muted">{hint}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 7: `Modal.tsx` 작성**

```tsx
"use client";

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "./icons";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}

const SIZE = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" } as const;

export function Modal({ open, onClose, title, size = "md", children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/65 backdrop-blur-sm sm:items-center sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-h-[90dvh] w-full overflow-y-auto border border-line bg-surface-overlay",
          "rounded-t-xl sm:rounded-xl",
          SIZE[size]
        )}
      >
        <div className="flex items-start gap-3 p-5 pb-0">
          {title && <h2 className="font-serif text-title font-bold text-content-primary">{title}</h2>}
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto rounded-sm p-1 text-content-muted transition-colors hover:text-content-primary"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
```

> 모바일에서 바텀시트(`items-end` + `rounded-t-xl`)로, 640px 이상에서 중앙 모달로 뜬다.

- [ ] **Step 8: `ProgressBar.tsx` 작성**

```tsx
import { cn } from "@/lib/cn";

export interface ProgressBarProps {
  value: number; // 0-100
  tone?: "growth" | "altitude";
  className?: string;
}

export function ProgressBar({ value, tone = "growth", className }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-line", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "growth" ? "bg-growth" : "bg-[linear-gradient(90deg,#3F8F47,#7CC4F0)]"
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
```

- [ ] **Step 9: `Avatar.tsx` 작성**

```tsx
"use client";

import { cn } from "@/lib/cn";

export interface AvatarProps {
  emoji: string;
  name?: string;
  size?: "sm" | "md";
  onClick?: () => void;
}

export function Avatar({ emoji, name, size = "sm", onClick }: AvatarProps) {
  const content = (
    <>
      <span className={size === "sm" ? "text-body" : "text-title"}>{emoji}</span>
      {name && <span className="truncate text-caption text-content-secondary">{name}</span>}
    </>
  );
  const base = "inline-flex min-w-0 items-center gap-2";
  if (!onClick) return <span className={base}>{content}</span>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(base, "rounded-full transition-colors hover:text-content-primary")}
    >
      {content}
    </button>
  );
}
```

- [ ] **Step 10: `Tabs.tsx` 작성**

```tsx
"use client";

import { Chip } from "./Chip";

export interface TabsProps<T extends string> {
  items: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

export function Tabs<T extends string>({ items, value, onChange }: TabsProps<T>) {
  return (
    <div role="tablist" className="flex gap-2 overflow-x-auto">
      {items.map((it) => (
        <Chip key={it.value} interactive selected={it.value === value} onClick={() => onChange(it.value)}>
          {it.label}
        </Chip>
      ))}
    </div>
  );
}
```

- [ ] **Step 11: `EmptyState.tsx` 작성**

```tsx
import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <p className="text-body font-semibold text-content-secondary">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-sm text-body-sm text-content-muted">{description}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
```

- [ ] **Step 12: `components/ui/index.ts` 배럴**

```ts
export { Button } from "./Button";
export type { ButtonProps } from "./Button";
export { Chip } from "./Chip";
export type { ChipProps } from "./Chip";
export { Card } from "./Card";
export type { CardProps } from "./Card";
export { Field } from "./Field";
export type { FieldProps } from "./Field";
export { Modal } from "./Modal";
export type { ModalProps } from "./Modal";
export { ProgressBar } from "./ProgressBar";
export type { ProgressBarProps } from "./ProgressBar";
export { Avatar } from "./Avatar";
export type { AvatarProps } from "./Avatar";
export { Tabs } from "./Tabs";
export type { TabsProps } from "./Tabs";
export { EmptyState } from "./EmptyState";
export type { EmptyStateProps } from "./EmptyState";
export * from "./icons";
```

- [ ] **Step 13: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

Expected: 통과. 화면은 전혀 변하지 않는다(아직 아무도 안 씀).

- [ ] **Step 14: 커밋**

```bash
git add frontend/lib/cn.ts frontend/components/ui
git commit -m "feat(ui): add token-based UI primitives

Ten primitives (Button, Chip, Card, Field, Modal, ProgressBar, Avatar,
Tabs, EmptyState) plus an SVG icon set, all built only from the design
tokens. No screen consumes them yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 앱 셸 — 레일 / 탭바 분기

**Files:**
- Create: `frontend/components/shell/nav-items.ts`, `SideRail.tsx`, `TabBar.tsx`, `AppShell.tsx`
- Modify: `frontend/app/layout.tsx`
- Delete: `frontend/components/SideNav.tsx`

**Interfaces:**
- Consumes: Task 2의 `cn`, 아이콘
- Produces: `<AppShell>{children}</AppShell>` — 모든 페이지를 감싼다. 페이지는 더 이상 `ml-[230px]` 같은 여백을 스스로 갖지 않는다.

- [ ] **Step 1: `nav-items.ts` — 내비 항목 단일 정의**

```ts
import type { ComponentType } from "react";
import { BeanIcon, CalendarIcon, ForestIcon, SeedIcon, SproutIcon } from "@/components/ui/icons";

export interface NavItem {
  key: string;
  label: string;
  shortLabel: string; // tab bar (tighter)
  Icon: ComponentType<{ size?: number; className?: string }>;
  /** null means "resolve at runtime from the signed-in user". */
  href: string | null;
  requiresAuth: boolean;
  /** Highlighted as the primary action in the mobile tab bar. */
  primary?: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "mine", label: "내 콩나무", shortLabel: "내 콩나무", Icon: SproutIcon, href: null, requiresAuth: true },
  { key: "schedule", label: "일정", shortLabel: "일정", Icon: CalendarIcon, href: "/schedule", requiresAuth: true },
  { key: "forest", label: "로드맵 숲", shortLabel: "숲", Icon: ForestIcon, href: "/", requiresAuth: false },
  { key: "new", label: "새 씨앗 심기", shortLabel: "심기", Icon: SeedIcon, href: "/new", requiresAuth: false, primary: true },
  { key: "ranking", label: "콩 랭킹", shortLabel: "랭킹", Icon: BeanIcon, href: "/ranking", requiresAuth: false },
] as const;

/** Tab-bar order puts the primary action in the centre, within thumb reach. */
export const TAB_ORDER: readonly string[] = ["forest", "schedule", "new", "ranking", "mine"];
```

- [ ] **Step 2: `SideRail.tsx` — 데스크톱 좌측 레일**

기존 `SideNav.tsx`의 동작(로그아웃, 인증 전 뱃지, 미로그인 시 `/login`)을 **그대로 보존**한다. 달라지는 건 `fixed`가 아니라 레이아웃 컬럼이라는 점과 토큰 적용이다.

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { KeyIcon } from "@/components/ui/icons";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS } from "./nav-items";

const ITEM =
  "flex w-full items-center gap-2.5 rounded-sm px-3 py-2.5 text-left text-body-sm font-semibold transition-colors";

export function SideRail() {
  const pathname = usePathname();
  const router = useRouter();
  const { me, loading, logout } = useAuth();

  function targetFor(key: string, href: string | null, requiresAuth: boolean): string {
    if (requiresAuth && !me) return "/login";
    if (href) return href;
    // "내 콩나무": the user grows several, so land on their profile.
    return me ? `/profile/${me.id}` : "/login";
  }

  function isActive(key: string, href: string | null): boolean {
    if (key === "mine") {
      return pathname.startsWith("/roadmap") || (me !== null && pathname === `/profile/${me.id}`);
    }
    return pathname === href;
  }

  async function handleLogout() {
    await logout();
    router.push("/");
  }

  return (
    <nav className="sticky top-0 hidden h-dvh w-rail shrink-0 flex-col gap-1 border-r border-line bg-surface-overlay p-4 backdrop-blur-md md:flex">
      <div className="mb-4 px-1">
        <div className="font-serif text-heading font-bold text-content-primary">Career Compass</div>
        <div className="mt-0.5 text-micro tracking-[.08em] text-content-muted">콩나무 로드맵</div>
      </div>

      {NAV_ITEMS.map(({ key, label, Icon, href, requiresAuth }) => (
        <button
          key={key}
          type="button"
          onClick={() => router.push(targetFor(key, href, requiresAuth))}
          className={cn(
            ITEM,
            isActive(key, href) ? "bg-goal/18 text-goal-bright" : "text-content-secondary hover:bg-goal/10"
          )}
        >
          <Icon />
          {label}
        </button>
      ))}

      <div className="mt-3 border-t border-line pt-3">
        {loading ? (
          <div className="h-9 w-full animate-pulse rounded-sm bg-white/5" />
        ) : me ? (
          <div className="flex flex-col gap-1">
            <Link
              href={me.yonsei_verified ? `/profile/${me.id}` : "/verify"}
              className="flex items-center gap-2 rounded-sm px-3 py-2 text-body-sm font-semibold !text-content-secondary no-underline transition-colors hover:bg-goal/10"
            >
              <span className="text-body">{me.avatar_emoji}</span>
              <span className="truncate">{me.display_name}</span>
              {!me.yonsei_verified && (
                <span className="ml-auto shrink-0 rounded-full bg-wither/18 px-1.5 py-0.5 text-micro font-semibold text-wither">
                  인증 전
                </span>
              )}
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-sm px-3 py-1.5 text-left text-caption text-content-muted transition-colors hover:bg-goal/10 hover:text-content-secondary"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/login")}
            className={cn(
              ITEM,
              pathname === "/login" || pathname === "/signup"
                ? "bg-goal/18 text-goal-bright"
                : "text-content-secondary hover:bg-goal/10"
            )}
          >
            <KeyIcon />
            로그인
          </button>
        )}
      </div>
    </nav>
  );
}
```

- [ ] **Step 3: `TabBar.tsx` — 모바일 하단 탭바**

```tsx
"use client";

import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS, TAB_ORDER, type NavItem } from "./nav-items";

export function TabBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { me } = useAuth();

  const ordered = TAB_ORDER.map((k) => NAV_ITEMS.find((i) => i.key === k)).filter(
    (i): i is NavItem => Boolean(i)
  );

  function targetFor(key: string, href: string | null, requiresAuth: boolean): string {
    if (requiresAuth && !me) return "/login";
    if (href) return href;
    return me ? `/profile/${me.id}` : "/login";
  }

  function isActive(key: string, href: string | null): boolean {
    if (key === "mine") {
      return pathname.startsWith("/roadmap") || (me !== null && pathname === `/profile/${me.id}`);
    }
    return pathname === href;
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-line bg-surface-overlay px-1 backdrop-blur-lg md:hidden"
      style={{
        height: "calc(var(--tabbar-h) + var(--safe-bottom))",
        paddingBottom: "var(--safe-bottom)",
      }}
    >
      {ordered.map(({ key, shortLabel, Icon, href, requiresAuth, primary }) => {
        const target = targetFor(key, href, requiresAuth);

        if (primary) {
          return (
            <button
              key={key}
              type="button"
              aria-label={shortLabel}
              onClick={() => router.push(target)}
              className="-mt-4 flex h-12 w-12 items-center justify-center rounded-full bg-[linear-gradient(160deg,#3F8F47,#2F6FBF)] text-white shadow-[0_5px_18px_rgba(47,111,191,.45)]"
            >
              <Icon size={22} />
            </button>
          );
        }

        return (
          <button
            key={key}
            type="button"
            onClick={() => router.push(target)}
            className={cn(
              "flex min-w-[56px] flex-col items-center gap-1 py-1.5 text-micro font-semibold transition-colors",
              isActive(key, href) ? "text-goal-bright" : "text-content-muted"
            )}
          >
            <Icon size={20} />
            {shortLabel}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: `AppShell.tsx`**

```tsx
"use client";

import type { ReactNode } from "react";
import { SideRail } from "./SideRail";
import { TabBar } from "./TabBar";

export interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh bg-altitude">
      <SideRail />
      <main
        className={
          "mx-auto min-w-0 w-full max-w-5xl flex-1 px-4 pt-6 md:px-8 md:pt-10 " +
          // Keep content clear of the mobile tab bar.
          "pb-[calc(var(--tabbar-h)+var(--safe-bottom)+16px)] md:pb-10"
        }
      >
        {children}
      </main>
      <TabBar />
    </div>
  );
}
```

> **핵심**: 레일이 `fixed`가 아니라 flex 컬럼이므로 본문을 덮지 않는다. 기존 클릭 차단 버그가 여기서 사라진다.

- [ ] **Step 5: `layout.tsx` 수정**

```tsx
import type { Metadata, Viewport } from "next";
import { Gowun_Batang, IBM_Plex_Sans_KR } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

const gowun = Gowun_Batang({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-gowun" });
const plex = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "Career Compass — 콩나무 로드맵",
  description: "목표를 심으면 콩나무가 자라는 로드맵 SNS",
};

export const viewport: Viewport = {
  themeColor: "#06120A",
  viewportFit: "cover", // required for env(safe-area-inset-bottom)
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${gowun.variable} ${plex.variable} font-sans antialiased`}>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
```

> 캔버스 페이지(`/roadmap/[id]`, `/goal/[id]`)는 Task 4d에서 컨테이너를 벗어나도록 처리한다. 그때까지 잠시 어색하게 보이는 건 정상이다.

- [ ] **Step 6: 구 `SideNav.tsx` 삭제**

```bash
cd frontend
grep -rn "SideNav" app components
```

`layout.tsx` 외 참조가 없음을 확인한 뒤:

```bash
git rm components/SideNav.tsx
```

- [ ] **Step 7: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

스크린샷 매트릭스(390 / 768 / 1280)에서 확인할 것:
- 390px: 하단 탭바가 뜨고 좌측 레일이 없다. 가운데 ＋ 버튼이 보인다. 가로 스크롤 없음.
- 768px: 좌측 레일이 뜨고 탭바가 사라진다.
- 1280px: 레일 + 중앙 본문. **본문 첫 요소가 레일에 덮이지 않는다.**

- [ ] **Step 8: 커밋**

```bash
git add -A frontend/components frontend/app/layout.tsx
git commit -m "feat(shell): responsive app shell with rail and tab bar

Replaces the fixed-overlay SideNav with a layout column rail above 768px
and a bottom tab bar below it. Because the rail now occupies layout space
instead of floating over the page, it can no longer cover and block the
first interactive element on narrow viewports.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4a: 관문 화면 (login · signup · verify · reset-password · privacy)

**Files:**
- Modify: `frontend/app/login/page.tsx` (82줄), `signup/page.tsx` (220), `verify/page.tsx` (240), `reset-password/page.tsx` (121), `privacy/page.tsx` (40)

**Interfaces:**
- Consumes: `Button`, `Field`, `Card`, `EmptyState` (Task 2), `AppShell` 컨테이너 (Task 3)
- Produces: 없음 (말단 화면)

- [ ] **Step 1: 인라인 입력창을 `Field`로 교체**

4개 화면이 각자 손으로 그린 `<input>` + 라벨 + 에러 문구를 전부 `<Field id=... label=... error=... />`로 바꾼다. `id`는 필수이며 폼 내 유일해야 한다(예: `login-username`, `signup-email`, `verify-code`, `reset-new-password`).

- [ ] **Step 2: 버튼을 `Button`으로 교체**

- 제출 버튼 → `<Button variant="primary" size="md" fullWidth type="submit">`
- 보조 링크형 버튼 → `<Button variant="ghost" size="sm">`
- 위험 동작(반려/취소) → `<Button variant="danger" size="sm">`

- [ ] **Step 3: 레이아웃 컨테이너 정리**

`AppShell`이 이미 `max-w-5xl px-4 md:px-8`을 제공하므로 페이지가 스스로 갖고 있던 `mx-auto`, `w-[640px]`, `ml-[max(206px,calc((100vw-640px)/2))]` 클램프(커밋 `a3a26e6`의 임시 코드)를 **전부 제거**한다. 관문 화면은 폼이므로 안쪽에 한 겹만 둔다:

```tsx
<div className="mx-auto w-full max-w-md">
  {/* form */}
</div>
```

- [ ] **Step 4: 색·폰트 토큰 치환**

Global Constraints의 색 매핑표를 적용한다. 특히:
- 제목: `font-serif text-display font-bold text-content-primary`
- 설명: `text-body-sm text-content-secondary`
- 에러: `text-caption text-wither`

- [ ] **Step 5: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
cd frontend && grep -rnE 'rgba\(|text-\[[0-9]|rounded-\[[0-9]|ml-\[|w-\[640px\]' app/login app/signup app/verify app/reset-password app/privacy
```

Expected: grep 결과 없음.

스크린샷 390 / 768 / 1280. 브라우저에서 로그인 폼 입력과 에러 표시가 정상인지 확인한다(가입 실행은 하지 않는다).

- [ ] **Step 6: 커밋**

```bash
git add frontend/app/login frontend/app/signup frontend/app/verify frontend/app/reset-password frontend/app/privacy
git commit -m "refactor(auth-ui): rebuild gateway screens on UI primitives

Replaces four hand-rolled copies of the labelled input with the shared
Field primitive and drops the per-page nav-clearance clamps now that the
app shell reserves rail space in layout.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4b: 피드 홈

**Files:**
- Modify: `frontend/app/page.tsx` (187줄), `frontend/components/MiniBeanstalk.tsx` (71줄)

**Interfaces:**
- Consumes: `Card`, `Tabs`, `Button`, `Avatar`, `ProgressBar`, `EmptyState`, `TargetIcon`, `WitherIcon`
- Produces: 없음

- [ ] **Step 1: 탭을 `Tabs`로 교체**

```tsx
const TABS = [
  { value: "all", label: "전체" },
  { value: "following", label: "팔로잉" },
] as const satisfies readonly { value: FeedScope; label: string }[];

<Tabs items={TABS} value={scope} onChange={setScope} />
```

- [ ] **Step 2: 카드 그리드를 반응형으로**

기존 `grid-cols-[repeat(auto-fill,minmax(252px,1fr))]`은 390px에서 카드가 화면을 넘친다. 교체:

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
```

본문 폰트가 15px로 커졌으므로 카드 높이도 늘어난다. 로딩 스켈레톤 높이 `h-[280px]`를 `h-72`로 맞춘다.

- [ ] **Step 3: 카드 본문을 프리미티브로**

- 카드 컨테이너 → `<Card interactive onClick={...}>`
- 이모지 🥀 → `<WitherIcon className="text-wither" />`
- 이모지 🎯 → `<TargetIcon className="text-goal-bright" />`
- 작성자 → `<Avatar emoji={card.user.avatar_emoji} name={card.user.display_name} onClick={...} />`
- 진행률 → `<ProgressBar value={card.progress_pct} />` + `text-growth-bright` 퍼센트 라벨
- 팔로우 버튼 → `<Button size="sm" variant={card.is_following ? "secondary" : "ghost"}>`
- 빈 상태 → `<EmptyState title=... description=... />`

**주의**: 카드 안의 팔로우 버튼과 작성자 버튼은 카드 클릭과 겹치므로 기존 `e.stopPropagation()`을 반드시 유지한다.

- [ ] **Step 4: `MiniBeanstalk` 색 토큰화**

SVG 내부라 Tailwind 클래스 대신 상수로 둔다: 줄기 `#3F8F47`, 잎 `#8FDC8A`, 시든 상태 `#8A6A3A`.

- [ ] **Step 5: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
cd frontend && grep -nE 'rgba\(|text-\[[0-9]|rounded-\[[0-9]|ml-\[230px\]' app/page.tsx components/MiniBeanstalk.tsx
```

Expected: grep 결과 없음.

스크린샷 390 / 768 / 1280. 390px에서 카드가 1열이고 가로 스크롤이 없는지, 팔로우 버튼 클릭이 카드 이동을 트리거하지 않는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add frontend/app/page.tsx frontend/components/MiniBeanstalk.tsx
git commit -m "refactor(feed): rebuild the forest feed on UI primitives

Single-column on phones, up to four across on wide screens. Card chrome
now comes from Card/Avatar/ProgressBar instead of inline rgba.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4c: 씨앗 심기 `/new`

**Files:**
- Modify: `frontend/app/new/page.tsx` (330줄), `frontend/components/FieldChips.tsx` (114줄), `frontend/components/SourceBadges.tsx` (80줄)

**Interfaces:**
- Consumes: `Chip`, `Button`, `Card`, `Field`, `ProgressBar`
- Produces: 없음

- [ ] **Step 1: 대화 말풍선 반응형·토큰화**

말풍선 최대폭을 고정값에서 `max-w-[85%] sm:max-w-[72%]`로 바꾸고 색을 나눈다:
- AI: `bg-surface-raised border border-line text-content-primary`
- 사용자: `bg-goal/18 border border-line-strong text-content-primary`
- 폰트: `text-body`

- [ ] **Step 2: `FieldChips`를 `Chip`으로 교체**

기존 타원형 칩 구현을 `<Chip interactive selected={...} onClick={...}>`으로 바꾼다.
`data-testid="field-chips"` 컨테이너 속성은 **유지**한다(브라우저 검증에 쓰인다).
최대 3개 선택 제한(`MAX_FIELD_SELECTION`)과 "기타 19개 +" 펼침 로직은 그대로 둔다.

- [ ] **Step 3: 입력창을 `Field`로, 전송 버튼을 `Button`으로**

입력 영역을 `sticky bottom-0`으로 두되, `AppShell`이 이미 탭바 높이만큼 하단 패딩을 주므로 추가 여백은 넣지 않는다.

- [ ] **Step 4: 프리뷰 패널 반응형**

프리뷰 마일스톤 목록에 `min-w-0`와 `break-words`를 적용해 좁은 화면에서 넘치지 않게 한다. `details` 토글 구조는 유지.

- [ ] **Step 5: 진행 상태 표시**

폴링 중 표시("접수 → 웹 검색 중")를 `ProgressBar` + 상태 문구로 정리한다. 실제 진행률을 백엔드가 주지 않으므로 **경과 시간을 실측 완주 시간(약 6분)으로 나눈 근사치**를 쓰고, 95%에서 멈춰 완료 전에 100%로 보이지 않게 한다.

```tsx
// The backend reports a status string, not a percentage. Approximate from
// elapsed time against the ~6 min observed end-to-end web-search run, and
// cap below 100 so the bar never claims completion before the job returns.
const PREVIEW_ETA_MS = 6 * 60 * 1000;
const approxPct = Math.min(95, (elapsedMs / PREVIEW_ETA_MS) * 100);

<ProgressBar tone="altitude" value={approxPct} />
<p className="mt-2 text-caption text-content-muted">{statusLabel}</p>
```

`statusLabel`은 기존 `onStatus` 콜백이 주는 값을 그대로 쓴다.
**폴링 로직(2.5초 간격, 240회 = 10분 예산, `AbortSignal`, 페이지 이탈 시 중단)은 절대 건드리지 않는다.**

- [ ] **Step 6: `SourceBadges` 토큰화**

파비콘 원형 칩 배경/테두리를 `bg-white`/`border-line`으로, 라벨을 `text-caption text-content-muted`로.
최대 6개 + "+N" 로직과 파비콘 실패 시 이니셜 폴백은 유지.

- [ ] **Step 7: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

**기능 검증 (Mock LLM, 비용 0원)**: 백엔드를 `ANTHROPIC_API_KEY` 없이(또는 `sk-ant-...` 플레이스홀더로) 기동하면 `use_real_llm`이 꺼져 `MockClaudeClient`가 결정론적으로 질문 5개 + 로드맵 2개 세트를 반환한다. 이 상태로 `/new`에서 분야 칩 선택 → 대화 → 프리뷰 → 심기까지 통과하는지 확인한다.

스크린샷 390 / 768 / 1280.

- [ ] **Step 8: 커밋**

```bash
git add frontend/app/new frontend/components/FieldChips.tsx frontend/components/SourceBadges.tsx
git commit -m "refactor(new): rebuild the seed-planting flow on UI primitives

Chat bubbles, field chips and the preview panel now use shared
primitives and reflow on narrow viewports. The preview polling contract
is untouched.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4d: 콩나무 상세 — 캔버스 반응형

**가장 위험한 태스크.** `BeanstalkCanvas`는 지오메트리를 전부 내부에 갖고 있다.

**Files:**
- Create: `frontend/app/roadmap/[id]/layout.tsx`, `frontend/app/goal/[id]/layout.tsx`
- Modify: `frontend/app/roadmap/[id]/page.tsx` (400줄), `frontend/app/goal/[id]/page.tsx` (185줄), `frontend/components/beanstalk-page.tsx` (152줄), `frontend/components/BeanstalkCanvas.tsx` (419줄)

**Interfaces:**
- Consumes: `Card`, `Button`, `Chip`, `Avatar`, `EmptyState`
- Produces: 없음

- [ ] **Step 1: 캔버스 페이지가 셸 컨테이너를 벗어나게**

`layout.tsx`의 `AppShell`은 전역이라 페이지별 prop을 줄 수 없다. 라우트별 레이아웃으로 컨테이너 패딩을 상쇄한다.

`frontend/app/roadmap/[id]/layout.tsx`와 `frontend/app/goal/[id]/layout.tsx`를 각각 만들되 내용은 동일하게:

```tsx
export default function CanvasLayout({ children }: { children: React.ReactNode }) {
  // Cancel the shell's padded container: canvas pages paint edge to edge.
  return <div className="-mx-4 -mt-6 md:-mx-8 md:-mt-10">{children}</div>;
}
```

- [ ] **Step 2: `BeanstalkCanvas`에 폭 스케일 도입**

고정 픽셀 지오메트리를 컨테이너 폭에 비례시킨다. 컴포넌트 상단에 추가:

```tsx
const DESIGN_WIDTH = 640; // the width the geometry was authored against

function useCanvasScale(ref: React.RefObject<HTMLDivElement>): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      // Never upscale past the authored width; only shrink for narrow screens.
      setScale(Math.min(1, w / DESIGN_WIDTH));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}
```

기존 지오메트리 상수(줄기 폭, 가지 길이, 노드 간격, 잎 위치)에 `scale`을 곱한다.
**줄기 테이퍼 폴리곤이 프로그레스 바 역할을 하므로 진행률 계산식 자체는 건드리지 않는다 — 좌표만 스케일한다.**

- [ ] **Step 3: 하단 탭바 안전 여백**

캔버스 스크롤 컨테이너 맨 아래에 여백 요소를 둔다:

```tsx
<div
  className="md:h-4"
  style={{ height: "calc(var(--tabbar-h) + var(--safe-bottom) + 16px)" }}
/>
```

- [ ] **Step 4: 랜딩 스크롤 위치 재계산**

`beanstalk-page.tsx`의 `computeLandingScrollTop`이 고정 픽셀을 전제하므로 `scale`을 인자로 받아 반영하도록 수정한다. 수정 후 마운트 시 첫 미완료 마일스톤이 화면에 들어오는지 세 뷰포트에서 확인한다.

- [ ] **Step 5: 공용 부품 토큰화**

`beanstalk-page.tsx`의 `CHIP_STYLE` → `Chip`, `CenteredNotice` → `EmptyState`, `BranchPanel`/`PlanterInfo`/`OwnerChip` → `Card`/`Avatar`/`Chip` 조합으로 바꾼다.

- [ ] **Step 6: 독수리 모티프 (설계 문서 3절)**

밤하늘 영역(캔버스 최상단, 목표 지점 부근)에 `EagleIcon` 실루엣 하나를 아주 옅게 배치한다. 기존 `sway` 키프레임을 재사용해 미세하게 움직인다.

```tsx
{/* A single distant eagle marks the sky the beanstalk is climbing toward. */}
<EagleIcon
  size={26}
  className="pointer-events-none absolute text-goal-bright/25 [animation:sway_9s_ease-in-out_infinite]"
  style={{ left: "68%", top: 48 * scale }}
/>
```

완주(100%) 시점에는 불투명도를 `text-goal-bright/55`로 올린다. **기존 100% 축하 연출(줄기를 따라 잎이 돋는 웨이브)은 그대로 두고 대체하지 않는다** — confetti 금지 원칙과 동일하게, 독수리는 추가 장식일 뿐이다.

- [ ] **Step 7: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

스크린샷 390 / 768 / 1280 **각각에서** 확인:
- 줄기가 화면 밖으로 나가지 않는다
- 가지 패널이 잘리지 않는다
- 하단 탭바가 마지막 마일스톤을 가리지 않는다
- 진행률(줄기 채움 높이)이 세 뷰포트에서 동일한 비율이다
- 마일스톤 모달이 열리고 닫힌다
- 독수리 실루엣이 밤하늘에 옅게 보이되 본문을 방해하지 않는다

- [ ] **Step 8: 커밋**

```bash
git add frontend/app/roadmap frontend/app/goal frontend/components/beanstalk-page.tsx frontend/components/BeanstalkCanvas.tsx
git commit -m "feat(beanstalk): scale the canvas world to viewport width

The geometry was authored against a fixed 640px column. A ResizeObserver
now derives a shrink-only scale factor so the stem, branches and panels
fit phone widths without changing the progress computation.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4e: 프로필 + 모달

**Files:**
- Create: `frontend/app/profile/[id]/_components/ProfileHeader.tsx`, `GoalSection.tsx`, `DangerZone.tsx`
- Modify: `frontend/app/profile/[id]/page.tsx` (628줄), `frontend/components/MilestonePostModal.tsx` (383줄), `frontend/components/BeanShopModal.tsx` (97줄)

**Interfaces:**
- Consumes: `Modal`, `Card`, `Button`, `Chip`, `Avatar`, `ProgressBar`, `EmptyState`, `Field`, `TargetIcon`, `WitherIcon`
- Produces: 세 컴포넌트의 props

```ts
ProfileHeader: { user: UserOut; isMe: boolean; beanBalance: number | null;
                 followerCount: number; followingCount: number; beanstalkCount: number;
                 isFollowing: boolean; onToggleFollow: () => void; onOpenShop: () => void }
GoalSection:   { goals: { id: number; title: string; isFeatured: boolean;
                 roadmaps: RoadmapCardOut[] }[]; legacyRoadmaps: RoadmapCardOut[];
                 isMe: boolean; onToggleFeatured: (goalId: number, next: boolean) => void }
DangerZone:    { onDeleted: () => void }
```

> 정확한 타입 이름은 `frontend/lib/types.ts`에 이미 있는 것을 그대로 쓴다. 새 타입을 만들지 않는다.

- [ ] **Step 1: 두 모달을 `Modal` 셸 위로 이식**

`MilestonePostModal`과 `BeanShopModal`이 각자 갖고 있던 백드롭·Esc 처리·스크롤락을 지우고 `<Modal open onClose title size>`로 감싼다. 안쪽 콘텐츠(사진 업로드, 좋아요, 댓글, 콩 패키지 선택)는 유지한다.

**주의**: `MilestonePostModal`은 상단 가이드 섹션(`detail`이 없으면 `description` 폴백)을 기록 유무와 무관하게 **항상 표시**해야 한다. 이 동작을 깨뜨리지 말 것.

- [ ] **Step 2: 프로필 페이지 분할**

628줄은 한 파일이 감당하기에 크다. `_components/` 아래 3개로 나누고 `page.tsx`는 데이터 페칭과 조립만 남긴다. (Next.js App Router에서 `_`로 시작하는 폴더는 라우트가 되지 않는다.)

- [ ] **Step 3: 그리드 반응형**

콩나무 그리드를 `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`으로. 시든 콩나무 섹션(갈색 톤)은 `border-wither/30 text-wither`로 토큰화.

- [ ] **Step 4: 이모지 아이콘 교체**

🎯 → `<TargetIcon className="text-goal-bright" />`, 🥀 → `<WitherIcon className="text-wither" />`.
**`user.avatar_emoji`는 사용자 콘텐츠이므로 그대로 둔다.**

- [ ] **Step 5: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
cd frontend && grep -rnE 'rgba\(|text-\[[0-9]|rounded-\[[0-9]' app/profile components/MilestonePostModal.tsx components/BeanShopModal.tsx
```

Expected: grep 결과 없음.

브라우저 확인: 모달 열기/닫기(Esc·백드롭), 좋아요/댓글, "메인에 띄우기" 토글, 390px에서 모달이 바텀시트로 뜨는지.

- [ ] **Step 6: 커밋**

```bash
git add frontend/app/profile frontend/components/MilestonePostModal.tsx frontend/components/BeanShopModal.tsx
git commit -m "refactor(profile): split the profile page and share the modal shell

Extracts ProfileHeader, GoalSection and DangerZone out of a 628-line
page, and moves both modals onto the shared Modal primitive so backdrop,
escape handling and scroll locking exist in one place.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4f: 일정 + 랭킹

**Files:**
- Modify: `frontend/app/schedule/page.tsx` (430줄), `frontend/app/ranking/page.tsx` (111줄), `frontend/components/ScheduleCalendar.tsx` (142줄), `frontend/components/BeanCheckbox.tsx` (71줄), `frontend/components/DayCompleteCelebration.tsx` (100줄)

**Interfaces:**
- Consumes: `Card`, `Button`, `Chip`, `Field`, `EmptyState`, `Avatar`
- Produces: 없음

- [ ] **Step 1: 일정 화면 반응형**

상단 월 캘린더 + 하단 카테고리별 할 일 구조를 유지하되, 캘린더 셀을 `grid-cols-7`과 `aspect-square`로 잡아 폭에 비례하게 한다. 390px에서 날짜 숫자가 잘리지 않도록 `text-caption`을 쓴다.

- [ ] **Step 2: `BeanCheckbox` 유지 + 토큰화**

**"띠링" 사운드(Web Audio API 합성)와 진동(`navigator.vibrate`), 콩 pop 애니메이션은 제품 정체성이므로 절대 제거하지 않는다.** 색만 바꾼다: 체크 시 `bg-growth`, 미체크 시 `border-line`.

- [ ] **Step 3: 캘린더 콩 농도 유지**

완료 개수가 많을수록 진해지는 `opacity 0.4~1.0` 로직을 유지하고, 콩 색만 `#5DB35B`(growth)로 통일한다.

- [ ] **Step 4: 랭킹 화면**

순위 행을 `Card`로, 1~3위 강조를 `text-bloom`으로. 본인 행 하이라이트는 `bg-goal/12 border-line-strong`.
**"수확한 콩만 집계(구매 콩 제외)"라는 안내 문구를 반드시 유지**한다 — 랭킹 공정성 설명이다.

- [ ] **Step 5: `DayCompleteCelebration` 토큰화**

축하 연출의 `@keyframes`(globals.css)는 그대로 두고, 색만 `bloom`/`growth-bright`로 맞춘다.

- [ ] **Step 6: 검증**

```bash
npx tsc --noEmit && npm run lint && npm run build
```

브라우저 확인: 할 일 체크 시 소리·진동·콩 pop이 동작하는지, 캘린더 그날에 콩이 뜨는지, 390px에서 캘린더가 가로 스크롤 없이 들어가는지.

- [ ] **Step 7: 커밋**

```bash
git add frontend/app/schedule frontend/app/ranking frontend/components/ScheduleCalendar.tsx frontend/components/BeanCheckbox.tsx frontend/components/DayCompleteCelebration.tsx
git commit -m "refactor(schedule,ranking): fluid calendar grid and tokenised beans

The month grid now scales with the container instead of fixed cells. The
bean check feedback (synthesised chime, vibration, pop) is unchanged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 레거시 제거 + 최종 검증

**Files:**
- Modify: `frontend/tailwind.config.ts`

**Interfaces:**
- Consumes: Task 4a~4f 완료
- Produces: 완료 기준 충족

- [ ] **Step 1: 레거시 팔레트 잔존 사용처 확인**

```bash
cd frontend
grep -rnE '(text|bg|border|from|to)-(bean|moss|night)-[0-9]' app components
```

Expected: 결과 없음. 남아 있으면 색 매핑표에 따라 치환한다.

- [ ] **Step 2: `tailwind.config.ts`에서 레거시 블록 삭제**

Task 1에서 `// Legacy palettes stay until Task 5 removes their last usage.` 주석을 단 `bean`/`moss`/`night` 세 블록을 지운다.

- [ ] **Step 3: 금지 패턴 전수 검사**

```bash
cd frontend
echo "--- 하드코딩 rgba (ui 프리미티브 제외) ---"
grep -rn 'rgba(' app components | grep -v 'components/ui/' | wc -l
echo "--- 임의 폰트 크기 ---"
grep -rnE 'text-\[[0-9.]+px\]' app components | wc -l
echo "--- 임의 반경 ---"
grep -rnE 'rounded-\[[0-9]+px\]' app components | wc -l
echo "--- 고정 레이아웃 폭 ---"
grep -rnE 'ml-\[[0-9]|w-\[640px\]|left-\[22px\]' app components | wc -l
```

Expected: 전부 0. SVG 내부 좌표는 예외지만 색은 토큰 hex여야 한다.

- [ ] **Step 4: WCAG AA 대비비 검사**

목표는 본문 4.5:1, 큰 글자 3:1.

| 전경 | 배경 | 요구 |
|---|---|---|
| `#EAF3EE` (text-primary) | `#06120A` | ≥ 4.5 |
| `#EAF3EE` (text-primary) | `#0B1E3D` | ≥ 4.5 |
| `#9FB6AD` (text-secondary) | `#06120A` | ≥ 4.5 |
| `#7D968C` (text-muted) | `#06120A` | ≥ 4.5 |
| `#7CC4F0` (goal-bright) | `#06120A` | ≥ 4.5 |
| `#FFFFFF` | `#2F6FBF` (goal 버튼) | ≥ 4.5 |

미달 토큰이 있으면 명도를 올려 조정하고 `tailwind.config.ts`와 설계 문서(`docs/superpowers/specs/2026-08-12-frontend-design-overhaul-design.md` 4.1절)의 값을 함께 갱신한다.

- [ ] **Step 5: 골든 패스 회귀**

DB를 띄우고(`cd backend && docker compose up -d`) 백엔드를 Mock LLM 상태로 기동한 뒤, 브라우저에서 전 구간을 통과시킨다:

1. 로그인
2. 씨앗 심기 — 분야 칩 선택 → 대화 → 프리뷰 → 심기
3. 상세 페이지 진입 → 마일스톤 체크
4. 일정 화면 → 할 일 콩 체크 (소리·진동 확인)
5. 랭킹 화면
6. 프로필 → 모달 열기/닫기

각 단계를 **390px와 1280px 두 뷰포트**에서 확인한다.

- [ ] **Step 6: 백엔드 회귀 확인**

```bash
cd backend
pytest -q
```

Expected: 기존과 동일하게 통과(프론트 전용 작업이므로 영향 없음). 실패하면 이번 작업과 무관한 원인이므로 별도 조사한다.

- [ ] **Step 7: 최종 빌드**

```bash
cd frontend
npx tsc --noEmit && npm run lint && npm run build
```

- [ ] **Step 8: 커밋 및 푸시**

```bash
git add frontend/tailwind.config.ts
git commit -m "refactor(design): drop the legacy bean/moss/night palettes

Every screen now reads from the token layer, so the pre-overhaul
palettes have no remaining consumers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin feature/roadmap-sns
```

---

## 완료 기준 (설계 문서 10절과 동일)

- [ ] 하드코딩 `rgba()` 288회 → `components/ui/` 밖에서 0
- [ ] 폰트 크기 20종 → 7단 스케일만 사용 (`text-[Npx]` 0건)
- [ ] 390px 뷰포트에서 전 화면이 가로 스크롤 없이 동작
- [ ] 1020px 미만에서 내비가 본문 클릭을 차단하지 않음
- [ ] 골든 패스 전 구간 통과 (390px / 1280px)
- [ ] `tsc` · `lint` · `build` 전부 통과
- [ ] 백엔드 `pytest` 통과
