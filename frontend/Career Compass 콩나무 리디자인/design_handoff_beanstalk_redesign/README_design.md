# Handoff: Career Compass — 콩나무(Beanstalk) 로드맵 리디자인

## Overview
전공 미정 대학교 1~2학년을 위한 목표 로드맵 SNS의 프론트엔드 리디자인.
기존 카드 리스트 UI를 버리고, 로드맵 상세를 **세로로 자라는 콩나무**로 표현한다.
줄기 자체가 프로그레스 바이며, 마일스톤은 줄기에서 뻗은 가지 위에 좌우 번갈아 앉는다.
맨 아래 = 땅(시작점, 유저 아바타), 맨 위 = 구름 위 최종 목표.

## About the Design Files
`Beanstalk.dc.html`은 **HTML로 만든 디자인 레퍼런스(동작 프로토타입)**다. 프로덕션 코드로
복사하지 말 것. 이 문서와 프로토타입을 보고 **타깃 코드베이스(Next.js 14 App Router +
TailwindCSS + TypeScript strict, no any)** 의 기존 패턴으로 재구현하라.
프로토타입 내부의 상태관리/렌더 방식(단일 클래스 컴포넌트, inline style)은 참고용일 뿐이다.

## Fidelity
**High-fidelity.** 색상·타이포·간격·인터랙션 모두 최종안. 픽셀 단위로 재현하되,
스타일 값은 Tailwind 토큰/arbitrary value로 옮길 것.

## Tech Constraints (백엔드 확정, 변경 불가)
- 라우트 유지: `/` (피드), `/roadmap/[id]` (상세=콩나무), `/new` (AI 채팅 생성)
- 데이터 모델:
  - `Roadmap: { id, user: { display_name, avatar_emoji }, title, goal_raw_text, progress_pct, milestones[], is_following }`
  - `Milestone: { order_index, title, description, due_date, is_completed_manual, status: "완료" | "기한초과" | "진행중" }`
- UI 문구 전부 한국어. `progress_pct`는 서버 값을 신뢰하되, 프로토타입은 완료수/전체수로 계산함.

## Screens / Views

### 1. 로드맵 상세 `/roadmap/[id]` — 콩나무 (서비스의 심장)
**Layout**
- 전체 화면 고정(100vh), 내부에 세로 스크롤 컨테이너 1개.
- 스크롤 월드 높이: `SKY(780px) + n × SEG(360px) + GROUND(560px)` (n = 마일스톤 수).
- 배경(월드 전체에 세로 그라데이션):
  `linear-gradient(180deg, #233a52 0px, #152a3d 460px, #0f2820 {SKY+260}px, #081a0e 62%, #050e07 100%)`
  — 위(목표)로 갈수록 밝은 밤하늘, 아래로 갈수록 짙은 숲.
- 중앙에 SVG 캔버스: 너비 880px, `left:50%; translateX(-50%)`, viewBox `0 0 880 H`.

**콩나무 SVG (재현 필수 사항)**
- 줄기 중심선: `x(y) = 440 + 46·sin(y/230) + 16·sin(y/93)` (완만한 S커브), 20px 간격 샘플링.
- **테이퍼**: 줄기는 스트로크가 아니라 **채운 폴리곤**. half-width
  `hw(y) = 4.5 + 9.5 · (y - stemTop)/(stemBot - stemTop)` — 위는 가늘고 아래(땅)로 갈수록 굵다.
  - 미완료(어두운) 줄기: 외곽 폴리곤 scale 2.0 `#0e2013` opacity .55 + 내부 scale 1.0 `#173420`.
  - 완료(생생한) 줄기: 외곽 scale 2.0 `#2a6134` + 내부 scale 1.45 `#3f8f47` +
    하이라이트 라인(중심에서 `-hw·0.7` 오프셋) stroke `#6cc167` 5px, opacity .65.
- **줄기 = 프로그레스 바**: 가장 높은 완료 마일스톤 y − 80px 까지 밝은 줄기. 별도 % 바 없음.
- 마일스톤 i의 y좌표: `y = H - GROUND - (i + 0.5) × SEG` (order_index 오름차순, 아래→위).
- 가지: 좌우 번갈아(`i % 2`), quadratic 커브 `M stem → Q(±84, -2) → 끝점(±178, -30)`.
  상태별:
  - **완료**: 가지 stroke `#3f8f47` 9px, 잎 4장(#4ea355/#6abf63 교차, t=.32/.5/.68/.86),
    끝에 꽃(꽃잎 5장 `#efe8bd` ellipse rx5.5 ry11, 중심 `#e2b94f` r4.5), 덩굴 컬 `#5db35b`.
  - **진행중**: 가지 `#2c5b36` 6px, 작은 잎 1장 `#3f7d46`, 끝에 봉오리(`#79b56b` 물방울형).
  - **기한초과**: 가지가 아래로 처짐(끝점 +46px 아래, 길이 150px), 갈색 잎 2~3장
    (`#8a6a3a`, `#6e5430`, `#7a5c33`) — "물 줘야 함" 톤, 비난 아님.
  - 줄기 접점에 노트(circle r8): 완료 `#5db35b`/stroke `#8fdc8a`, 미완료 `#1c3a24`/stroke `#3f6f49`.
- 장식: 달(#e9edda/#f5f7ea, 우상단), 별 34개 twinkle(2.6~6.2s), 구름 5덩이(#c7d5e6 계열,
  opacity .16~.42, 목표 아래 플랫폼처럼 밀집), 땅 언덕 ellipse 2개(#0c2113/#081a0d),
  풀잎 path 14개(#1d4526), 반딧불이 14개(#d8e77a, floaty 6~10s — 토글 옵션).

**마일스톤 패널 (HTML 오버레이)**
- 위치: absolute, `top: y − 116px` (기한초과는 `y − 36px`), 폭 292px,
  우측: `left: min(calc(50% + 208px), calc(100% − 312px))`,
  좌측: `left: max(16px, calc(50% − 500px))` — 좁은 화면에서 클램프 필수.
- 카드: bg `rgba(7,22,12,.78)` + `backdrop-filter: blur(6px)`, border
  `1px solid rgba(143,220,138,.16)`, radius 14px, padding 14px 16px,
  shadow `0 8px 26px rgba(0,0,0,.38)`.
- 내용: 번호(Gowun Batang 13px `#7fae83`) · 상태 칩 · 마감일(11px `#6f8f74`, `~ 2026.03.15`) /
  제목(15.5px 700 `#eaf5e6`) / 설명(12.5px `#a9c3aa`) / 기한초과 노트(11.5px `#d8b078`,
  "괜찮아요 — 지금 완료하면 가지가 다시 자라요.") / 토글 버튼.
- 상태 칩(11px 600, radius 99px): 완료 `rgba(93,179,91,.2)`/`#8fdc8a`,
  진행중 `rgba(143,206,122,.13)`/`#c6ddba`, 기한초과 `rgba(196,154,90,.18)`/`#d8b078`.
- 토글 버튼(pill, 12.5px 600, `white-space: nowrap`): 완료 시 "✓ 완료됨"
  (`rgba(93,179,91,.22)` / border `rgba(143,220,138,.5)` / `#b9eab2`), 미완료 시 "완료로 표시"
  (`rgba(255,255,255,.04)` / border `rgba(143,220,138,.26)` / `#cfe6cb`).
  **내 로드맵에서만 렌더** — 남의 로드맵은 토글 없음.
- 한국어 줄바꿈: 루트에 `word-break: keep-all`, 모든 pill/칩에 `white-space: nowrap`.

**목표 영역 (월드 상단, top 120px, 중앙 620px)**
- eyebrow "최종 목표" (11.5px, letter-spacing .22em, `#9db8c9`)
- `goal_raw_text`: Gowun Batang 34px 700 `#f2f7ee`, `text-shadow: 0 2px 24px rgba(10,30,50,.8)`
- 서브: `{pct}% 자람 · {완료수}/{n} 마일스톤` (13px `#a8c2b3`)
- **100% 달성 시**: radial 글로우(560×360, `rgba(240,232,180,.3)`→투명, glowPulse 3.6s) +
  리본 "콩나무가 다 자랐어요 · 목표 달성" (`#f0e8b4`, bg `rgba(240,232,180,.13)`) +
  줄기 꼭대기에 꽃.

**땅 영역 (월드 하단, bottom 118px, 중앙)**
- 아바타 원 70px: `avatar_emoji` 34px, bg `rgba(16,36,21,.92)`, border `2px solid #3f6f49`,
  glow `0 0 34px rgba(93,179,91,.28)` / 이름 14px 700 / "{시작일} 씨앗 심음" 11.5px `#7fae83`.

**우상단 오너 칩 (뷰포트 고정, top 22px right 26px)**
- pill: 아바타 이모지 + "내 콩나무" 또는 "{이름}의 콩나무" + 진행 서브텍스트.
- **남의 로드맵일 때만** 팔로우/팔로잉 버튼 노출(팔로잉: `rgba(143,220,138,.16)`/`#b9eab2`).

### 2. 피드 `/` — 로드맵 숲
- 배경 `linear-gradient(180deg, #0a1f11, #06120a 60%)`, 콘텐츠 `margin-left: 230px`(내비 회피),
  max-width 1040px, 상단 패딩 88px.
- 헤더: "로드맵 숲" (Gowun Batang 30px 700) + "친구들의 콩나무가 자라는 곳 — 눌러서 구경해 보세요".
- 필터 pill 2개: **전체 / 팔로잉** (active: bg `rgba(143,220,138,.16)` text `#c8ecc2`).
- 카드 그리드: `repeat(auto-fill, minmax(252px, 1fr))`, gap 18px. 카드는 어두운 "화분" —
  bg `linear-gradient(180deg, rgba(14,33,20,.55), rgba(8,20,12,.85))`, border
  `rgba(143,220,138,.13)`, radius 18px. hover: border `rgba(143,220,138,.4)` + `translateY(-3px)`.
- 카드 내용: **미니 콩나무 SVG**(150×150 — 흙 ellipse `#132a18`, 줄기 높이 = `112 × pct/100`,
  잎 1~4장 = 진행률 비례, 100%면 꼭대기 꽃, 미완 구간은 가는 `#1c3a24` 선) / 제목 /
  이모지+이름 / "{pct}% 자람" / "마일스톤 {done}/{n}" / 팔로우·팔로잉 버튼
  (클릭 시 `stopPropagation`, 카드 클릭은 상세로 이동).
- 내 로드맵은 피드에서 제외.

### 3. 새 로드맵 `/new` — 새 씨앗 심기 (AI 채팅)
- 중앙 640px 컬럼. 헤더 "새 씨앗 심기" + "목표를 말해주면 AI가 콩나무가 자랄 길을 그려드려요".
- 채팅 버블: AI 좌측(bg `rgba(10,26,15,.85)`, border `rgba(143,220,138,.14)`),
  유저 우측(bg `rgba(63,143,71,.25)`, border `rgba(93,179,91,.35)`). radius 16px, 13.5px/1.65.
- 목표 전송 → 로딩 인디케이터("뿌리를 내리는 중…" + 점 3개 blink) → AI가 마일스톤 5개
  제안(버블 안 리스트: 번호 Gowun Batang + 제목 700 + 설명).
- 제안 후 sticky 하단에 CTA **"이 로드맵 심기"** (full-width, bg `#3f8f47`, border `#5db35b`,
  hover `#4aa353`) → 로드맵 생성 후 `/roadmap/[newId]`로 이동.
- 입력줄: input(bg `rgba(255,255,255,.05)`, border `rgba(143,220,138,.22)`, radius 12px) +
  "보내기" 버튼. Enter 전송.

### 내비게이션 (전 화면 공통, **좌측 상단** 고정)
- 하단 탭바/상단 가로 내비 금지. top 22px / left 22px, 폭 168px, 세로 스택.
- 컨테이너: bg `rgba(6,18,10,.74)` + blur(10px), border `rgba(143,220,138,.15)`, radius 16px.
- 브랜드: "Career Compass" (Gowun Batang 15px) + "콩나무 로드맵" (10.5px `#7fae83`).
- 항목 3개(아이콘 18px + 라벨 13px 600): **내 콩나무**(새싹 아이콘) / **로드맵 숲**(줄기 3개) /
  **새 씨앗 심기**(+). active: bg `rgba(143,220,138,.16)` text `#c8ecc2`,
  inactive text `#8aa78d`, hover bg `rgba(143,220,138,.16)`.

## Interactions & Behavior
- **첫 진입 스크롤**: 상세 진입 시 가장 아래의 미완료 마일스톤(`status !== "완료"` 첫 항목)
  y좌표 − 뷰포트높이×0.52 로 scrollTop 세팅. 전부 완료면 맨 위(목표)로. `scrollIntoView` 금지.
- **완료 토글** (낙관적 업데이트):
  1. `is_completed_manual` 반전. 해제 시 status는 `due_date < today ? "기한초과" : "진행중"`.
  2. **가지가 자라는 애니메이션**: 가지 path를 `stroke-dasharray: 300` +
     `stroke-dashoffset 300→0` 0.55s ease-out (줄기에서 바깥으로 뻗음). 이어서 잎/꽃 그룹이
     `transform-origin: 줄기 쪽` 기준 scale 0→1.18→1, 0.7s `cubic-bezier(.34,1.56,.64,1)`,
     delay 0.38s, `both`. ("위에서 떨어지는" 연출 금지 — 반드시 자라나는 방향.)
  3. 밝은 줄기 높이 갱신(테이퍼 폴리곤 재계산).
- **100% 축하**: confetti/꽃잎 낙하 금지. 대신 **줄기를 따라 아래→위로 잎 16장 + 꽃 4~5송이가
  차례로 돋아나는 웨이브** (각각 sprout 0.6s, delay k×0.09s, origin은 줄기 쪽) + 목표 글로우
  펄스 + 리본. 트리거 후 ~9초 유지.
- 남의 로드맵: 토글 비노출, 팔로우/팔로잉 토글만.
- 상시 모션(끌 수 있어야 함): 별 twinkle, 반딧불이 floaty, 꽃 sway(±2.4°, 5~8s).
- 설정 플래그 3개(프로토타입의 Tweaks에 대응): `fireflies`, `sway`, `celebratePreview`
  (축하 연출만 미리보기 — **진행률 수치/줄기 진행도는 절대 바꾸지 않음**).

## State Management
- 상세: `milestones`(낙관적 토글), `sprout`(방금 완료한 마일스톤 id — 애니메이션 1회 트리거,
  key 재발급으로 재생), `burst`(100% 달성 타임스탬프).
- 피드: `filter: "all" | "following"`, 팔로우 낙관적 토글.
- `/new`: `messages[]`, `pendingPlan`(AI 제안), `thinking`. 실제 구현은 AI 생성 API 연결.
- 프로토타입은 단일 컴포넌트지만, 실제로는 route별 분리 + 콩나무 SVG는
  `<BeanstalkCanvas roadmap={...} readOnly={...} onToggle={...}>` 정도의 클라이언트 컴포넌트 권장.

## Design Tokens
**Colors**
- 배경: `#06120a`(베이스), `#233a52→#152a3d`(상단 밤하늘), `#0f2820`, `#081a0e`, `#050e07`
- 줄기: 어두운 `#0e2013`/`#173420`, 밝은 `#2a6134`/`#3f8f47`/하이라이트 `#6cc167`
- 잎: `#4ea355`, `#6abf63`, `#5db35b`, `#8fdc8a` / 진행중 `#3f7d46`, `#79b56b`
- 시든 가지: `#8a6a3a`, `#7a5c33`, `#6e5430`, `#5a4527`
- 꽃: `#efe8bd`(꽃잎), `#e2b94f`(중심), 축하 글로우 `#f0e8b4`
- 텍스트: 주 `#eaf5e6`/`#f2f7ee`, 보조 `#a9c3aa`, 뮤트 `#7fae83`/`#6f8f74`, 하늘 `#9db8c9`
- 경고(기한초과) `#d8b078` / 링크 `#8fd694`, hover `#c3ecbc`
- 유리 패널: bg `rgba(6,18,10,.74)` 또는 `rgba(7,22,12,.78)` + border `rgba(143,220,138,.13~.16)`
**Typography** — 제목/번호: 'Gowun Batang' serif(700) / 본문·UI: 'IBM Plex Sans KR'(400~700).
Google Fonts 로드. 크기: 34/30(헤더), 15.5(패널 제목), 13~13.5(본문), 11~12.5(메타).
**Radius** — 카드 14~18px, pill 99px, 입력 12px.
**Keyframes** — `drawBranch`(dashoffset 300→0), `sprout`(scale 0→1.18→1),
`twinkle`, `floaty`, `sway`, `glowPulse`, `blink`.

## Assets
외부 이미지 없음. 모든 그래픽(콩나무, 달, 별, 구름, 꽃, 미니 콩나무)은 인라인 SVG로 그림.
아바타는 `avatar_emoji` 텍스트 렌더.

## Files
- `Beanstalk.dc.html` — 전체 프로토타입(3개 뷰 + 상태/애니메이션 로직 포함). 파일 내
  `buildStalk()`에 콩나무 지오메트리 전부, `mini()`에 피드용 미니 콩나무, 템플릿에 3개 뷰 마크업.

## 하지 말 것 (원 요구사항)
- 흰 배경 + 둥근 카드 + 프로그레스 바 나열식 SaaS 레이아웃
- 가로 스크롤 타임라인
- 콩나무를 장식으로만 쓰는 절충안 — **콩나무 자체가 UI**
