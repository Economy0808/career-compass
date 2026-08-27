---
name: OurLab
description: Constellation roadmap for undeclared Yonsei students - a dark observation sky, entered from a bright printed star-chart landing.
colors:
  ink-900: "#04060B"
  ink-800: "#131829"
  ink-700: "#1C2338"
  rule: "#2A3350"
  text-hi: "#E8EAF2"
  text-lo: "#8891AC"
  spec-b: "#9DB4FF"
  spec-a: "#E8ECFF"
  spec-g: "#FFD98A"
  spec-k: "#FFA76B"
  spec-m: "#FF7B72"
  lit: "#FFF3C4"
  paper: "#F6F7FA"
  paper-line: "#C9CEE0"
  paper-soft: "#E3E6F0"
  paper-ink: "#10141F"
  paper-lo: "#5C6480"
  paper-faint: "#AFB6CC"
typography:
  display:
    fontFamily: "Gowun Batang, serif"
    fontSize: "1.875rem"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "Gowun Batang, serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.35
  heading:
    fontFamily: "IBM Plex Sans KR, sans-serif"
    fontSize: "1.0625rem"
    lineHeight: 1.4
  body:
    fontFamily: "IBM Plex Sans KR, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "IBM Plex Mono, monospace"
    fontSize: "0.75rem"
    lineHeight: 1.5
    letterSpacing: "0.14em"
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
spacing:
  tabbar: "58px"
  rail: "196px"
components:
  button-primary:
    backgroundColor: "{colors.spec-b}"
    textColor: "{colors.ink-900}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-hi}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  input:
    backgroundColor: "rgb(4 6 11 / 0.6)"
    textColor: "{colors.text-hi}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
  card:
    backgroundColor: "rgb(19 24 41 / 0.7)"
    textColor: "{colors.text-hi}"
    rounded: "{rounded.lg}"
    padding: "16px"
---

# Design System: OurLab

## Overview

**Creative North Star: "종이 성도(星圖)와 관측 우주"**

하나의 시스템, 두 개의 세계. 로그인 전 랜딩은 청보라 잉크로 인쇄된 밝은 종이
성도(`--paper-*`, `.bg-paper-grid`, `components/TelescopeLanding.tsx`)이고,
로그인 후 모든 앱 화면은 칠흑에 가까운 관측 우주(`--ink-*`, `.bg-radec-grid`)다.
두 세계는 같은 청보라 색조를 공유하며, 다리 역할은 CTA 클릭 시 접안렌즈 원이
화면을 덮는 1회성 명→암 전환(`apertureOpen`)이 한다. 학생은 게임 플레이어가
아니라 자기 진로의 제도사(cartographer)이므로, 장식 어휘는 좌표 격자·계선·
눈금·선화 SVG로 제한된다 — 마스코트·일러스트·그라데이션 텍스트 없음.

이 문서는 토큰과 시스템 규칙만 기록한다. 기능이 깨지는 절대 규칙(SVG
`fill="transparent"`, 배경 상시 애니메이션 금지, 패널=오버레이 구조 등)의
단일 권위는 `docs/design-handoff-guide.md`다 — 여기 중복하지 않으며,
충돌 시 그 문서가 이긴다.

**Key Characteristics:**
- 다크 전용 앱 + 밝은 랜딩 단 하나의 예외 (두 팔레트 모두 청보라 색조)
- 천문 어휘가 곧 토큰 이름 (항성 분광형 spec-b/a/g/k/m, lit, 적경/적위 격자)
- 모션은 의미 있는 순간에만 — 상시 배경 애니메이션 금지
- 장식은 1px 헤어라인과 좌표 격자(불투명도 3~4.5%)로만

## Colors

칠흑 우주 위 항성 분광형 악센트, 그리고 그 잉크로 인쇄된 밝은 종이 — 한 잉크의 양면.

### Primary
- **Spec-B 항성청(spec-b)**: 시스템의 유일한 "행동" 색. 주 버튼 배경, 링크,
  포커스 링, 캐럿, `::selection`(28% 틴트)까지 브라우저 서피스 전부. 요소
  유형으로는 수업(course).

### Secondary — 분광형 악센트 (요소 유형 매핑)
- **spec-a**: 자격증 · **spec-g**: 학회 · **spec-k**: 대외활동 · **spec-m**: 네트워킹
  (spec-m은 파괴/오류 톤 겸용: DangerZone, 인테이크 오류 배너)
- 유형→색 매핑의 단일 진실 공급원은 `frontend/lib/element-colors.ts`.
  모르는 유형은 `--text-lo`로 안전 강등된다.

### Tertiary
- **별빛(lit)**: 이어진 간선(lit edge)과 달성 상태 전용 따뜻한 별빛.
  **초록이 아니다** — 원본 토큰 주석의 문구 그대로.

### Neutral — 관측 우주
- **ink-900**: 페이지 지면. 완전한 #000이 아니라 청보라 색조를 남긴 근검정 —
  성운 그라데이션 단차가 살아남는 최저 명도.
- **ink-800**: 패널/서피스 · **ink-700**: 융기·호버 · **rule**: 헤어라인·차트 격자
  (`/NN` 불투명도 단계로 사용) · **text-hi / text-lo**: 본문/보조 텍스트.

### Neutral — 종이 성도 (랜딩 전용)
- **paper**: 밝은 지면 · **paper-line / paper-soft**: 계선(프레임·눈금) ·
  **paper-ink / paper-lo**: 본문/보조 · **paper-faint**: 장식 선 전용 —
  읽는 텍스트에 쓰면 대비 미달(실측 1.9:1).

### Named Rules
**The Two-File Sync Rule.** 색 실값은 `app/globals.css`(CSS 변수)와
`tailwind.config.ts`(hex)에 이중화되어 있다. 반드시 두 파일을 같이 고친다 —
상세는 `docs/design-handoff-guide.md` §1.

**The Landing-Scope Rule.** `--paper-*`와 그에 딸린 포커스 링(잉크색)·스크롤바·
CTA 규칙은 `.telescope-landing` 스코프 안에서만 산다. 앱 서피스로 새어 나가면 안 된다.

## Typography

**Display Font:** Gowun Batang (`--font-gowun`, serif)
**Body Font:** IBM Plex Sans KR (`--font-plex`, Malgun Gothic fallback)
**Label/Mono Font:** IBM Plex Mono (`--font-plex-mono`)

**Character:** 붓 세리프 명조가 별자리 이름과 제목에 문서적 무게를 주고,
Plex Sans KR이 한글 본문을 담백하게 받친다. 본문 전역에 `word-break: keep-all`.

### Hierarchy
- **Display** (700, 30px/1.3, serif): 페이지 제목·별자리 이름 전용. UI chrome 금지.
- **Title** (700, 20px/1.35, serif): 섹션 제목, 랜딩 로고타입.
- **Heading** (17px/1.4): 패널 내 소제목.
- **Body** (400, 15px/1.65): 기본 본문. `text-body-sm`(13.5px)은 밀도 높은 패널용.
- **Caption / Micro** (12px / 10.5px): 라벨·메타. 모노 라벨은 tracking 0.14em.

### Named Rules
**The No-Korean-Mono Rule.** IBM Plex Mono에는 한글 글리프가 없다.
`font-mono`는 학정번호(예: BIZ2101)와 숫자 데이터 전용이다.
(권위: `docs/design-handoff-guide.md` §3-6)

## Layout

전체화면 별자리 캔버스가 바닥이고, 군집/노트 패널은 그 위에 떠 있는
오버레이다(`rounded-xl border-rule bg-ink-800/95 backdrop-blur-md`) — 그리드
컬럼이 아니다. 앱 셸은 좌측 레일 196px(`spacing.rail`)과 하단 탭바
58px(`spacing.tabbar`, `--tabbar-h` + safe-area)로 구성되고, 캔버스 페이지는
`--tabbar-h`만큼 공간을 예약한다. 좌표 격자는 48px 셀(`.bg-radec-grid` /
`.bg-paper-grid`), 불투명도 3~4.5% — 노드보다 튀면 실패다. 랜딩은 `inset-4`
(md: `inset-7`) 계선 프레임 안에 최대 1280px 그리드(좌 헤드라인 / 우 도면,
모바일은 도면 축소판이 위).

## Elevation & Depth

깊이는 주로 색조 레이어링(ink-900 → 800/불투명도+blur → 700)으로 표현하고,
그림자는 보조다. 떠 있는 패널은 반투명 배경 + `backdrop-blur-md`가 표준 재질.

### Shadow Vocabulary
- **panel** (`0 8px 26px rgb(0 0 0 / .38)`): 떠 있는 패널·팝오버.
- **overlay** (`0 14px 40px rgb(0 0 0 / .55)`): 모달급 오버레이.
- **glow-bloom** (`0 0 44px rgb(226 185 79 / .4)`): 달성 축하 순간의 별빛 발광.
- **fab** (`0 5px 18px rgb(47 111 191 / .45)`): 탭바 중앙 FAB.

### Named Rules
**The Starlight-Only Glow Rule.** 발광은 별빛(lit) 계열 순간에만 쓴다.
어두운 지면 위 상시 발광 장식은 없다.

## Shapes

부드러운 8/12/16/20px 라디우스 스케일(`rounded-sm/md/lg/xl`). 인풋·버튼은
12px, 카드·섹션은 16px, 떠 있는 패널은 20px. 경계는 채움 대비가 아니라 1px
`border-rule` 헤어라인이 담당한다(빈 상태는 `border-dashed`). 원형은 별·노드·
아바타·FAB 등 천체 은유가 있는 곳에만. 랜딩의 그림 언어는 선화 SVG(점선
시야원, 눈금, 점과 선)뿐이다.

## Components

### Buttons
- **Shape:** 12px 라디우스(`rounded-md`), `px-3 py-1.5`~`px-5 py-2.5`.
- **Primary:** spec-b 배경 + ink-900 텍스트, 호버는 `opacity-90` 또는 `brightness-110`.
- **Ghost/Secondary:** 투명 배경 + `border-rule`, 호버 시 `bg-ink-700`.
- **Focus:** 전역 규칙 — `outline 2px spec-b, offset 2px` (키보드 전용 `:focus-visible`).
- **Landing CTA (`.cta-ink`):** paper-ink 채움, 호버는 투명도가 아니라 "잉크가 더
  눌린" `#05070d`, active는 `translateY(1px)`.

### Cards / Containers
- **Corner:** 16px. **Background:** `bg-ink-800/70` + `backdrop-blur-[2px]`,
  떠 있는 패널은 `/95` + `blur-md`. **Border:** 1px rule. **Padding:** 16px.

### Inputs / Fields
- **Style:** `bg-ink-900/60` + `border-rule`, 12px 라디우스, placeholder는 text-lo.
- **Focus:** spec-b 아웃라인(전역 규칙과 동일). **Caret:** spec-b.
- **Disabled:** `opacity-50`.

### Chips (보관함 요소 칩)
- 유형 색 점(`colorForType`) + 라벨. 이미 캔버스에 놓인 요소는 흐림 + 체크.
- 세그먼트 탭(군집/노트): `bg-ink-900/60 p-1` 트랙 안 `rounded-md` 버튼.

### Navigation
- 좌측 레일 + 하단 탭바. 탭바 중앙 FAB는 spec-b→lit 그라데이션 원 +
  `shadow-fab`, ink-900 아이콘.

### Constellation Canvas (signature)
- SVG+CSS 그래프. 노드 색은 `lib/element-colors.ts`, 이어진 간선은 lit 색 +
  `edgeGlowPulse`(opacity만 애니메이션 — transform 금지, 실버그에서 나온 규칙).
- 구조·핸들러 규칙 일체는 `docs/design-handoff-guide.md` §2~3이 권위.

### Motion (컴포넌트 공통 문법)
- 의미 있는 순간에만: 발광 엣지, 호버 위성, 1회성 aperture 전환, 팬 제스처
  유발 배경 드리프트. 새 상시 모션 금지.
- 표준 이징: `cubic-bezier(.22,1,.36,1)` (sprout, celebratePop 등 등장 모션).
  aperture 전환만 material 표준 `cubic-bezier(0.4,0,0.2,1)` 650ms.
- 전역 `prefers-reduced-motion` kill switch가 globals.css에 있다 — 새
  애니메이션은 자동으로 꺼지되, `onAnimationEnd` 라우팅은 유지되게 설계할 것.

## Do's and Don'ts

### Do:
- **Do** 색은 globals.css + tailwind.config.ts 두 곳을 항상 같이 고친다 (§Colors).
- **Do** 유형→색은 `lib/element-colors.ts` 한 곳만 import한다.
- **Do** 새 인터랙티브 요소에 spec-b 포커스 링(랜딩에서는 paper-ink)을 유지한다.
- **Do** 장식 레이어는 `pointer-events: none` + 그래프 뒤에 둔다.

### Don't:
- **Don't** `font-mono`를 한글에 쓰지 않는다 — 글리프가 없다.
- **Don't** 배경 상시 애니메이션을 추가하지 않는다 (유일 예외: 팬 유발 드리프트).
- **Don't** 마스코트·일러스트·게임적 장식·그라데이션 텍스트를 쓰지 않는다.
- **Don't** `--paper-*`를 로그인 후 앱 서피스에 쓰지 않는다.
- **Don't** lit(간선/달성)에 초록을 쓰지 않는다 — 별빛은 따뜻한 노랑이다.
- **Don't** SVG 투명 채움에 `fill="none"`을 쓰지 않는다 (`docs/design-handoff-guide.md` §3-1).
