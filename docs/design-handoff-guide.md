# OurLab 디자인 외주 인계 가이드

외부 디자이너가 **기능 코드를 건드리지 않고** 시각 디자인만 교체할 수 있도록,
바꿔도 되는 지점과 절대 건드리면 안 되는 지점을 정리한 문서다.

## 1. 시각의 단일 진실 공급원 (여기만 바꾸면 된다)

| 파일 | 담당 | 주의 |
|---|---|---|
| `frontend/app/globals.css` | 모든 색 토큰(CSS 변수 `--ink-*`, `--spec-*`, `--lit`, `--rule`, `--text-*`), 키프레임, 배경 격자 유틸리티 | |
| `frontend/tailwind.config.ts` | 같은 토큰의 Tailwind 노출 | ⚠️ **hex가 CSS 변수와 별개로 하드코딩돼 있다. 두 파일을 반드시 같이 고칠 것.** 여기만 고치면 `bg-ink-900`류가 옛 색으로 남는다. Tailwind 설정 변경은 dev 서버 재시작 필요 |
| `frontend/app/layout.tsx` | 서체 로딩 (`next/font/google`) | Google Fonts만 사용 가능 |
| `frontend/lib/element-colors.ts` | 요소 유형→색 매핑 (캔버스 노드·군집 칩·노트 패널 공용) | 값은 CSS 변수 참조 — 실값 변경은 globals.css + tailwind.config.ts에서 |
| `frontend/components/SpaceBackdrop.tsx` | 캔버스 배경 장식(별밭) + 팬 시 비문증(eye-floater) 관성 드리프트 + 별 반짝임(`starTwinkle`) | **props 없는 순수 장식 컴포넌트 — 통째로 교체 가능한 스왑 포인트.** 그래픽 자체에는 로직이 없지만, `window`의 `"ourlab:canvas-pan"` CustomEvent(`{dx, dy}`, `ConstellationCanvas.tsx`의 팬 핸들러가 쏨)를 구독해 감쇠 스프링으로 아주 살짝 흔들리다 멎는 효과를 낸다. 캔버스는 이 파일의 내부를 몰라도 되고(디커플링), 통째로 교체할 때 이 이벤트 구독을 유지하면 드리프트 효과도 함께 유지된다 — 굳이 유지할 필요는 없고, 정적인 배경으로 되돌려도 무방(swap 자유). 별마다 CSS `starTwinkle` 애니메이션(상시, §3-4의 예외)이 걸려 있고 `animationDelay`는 음수로 줘서 마운트 즉시 주기 중간에서 시작한다(양수면 delay가 끝나는 순간 "툭" 튀어 보임) |

## 2. 컴포넌트 지도 — 장식 vs 로직

- **자유롭게 재스킨 가능**: `SpaceBackdrop.tsx`(전체 교체 OK), `shell/SideRail.tsx`·`shell/TabBar.tsx`(스타일만),
  `ui/*`(공용 프리미티브), 각 페이지의 마크업 클래스.
- **스타일은 바꿔도 되지만 구조·핸들러는 금지**: `ConstellationCanvas.tsx`, `ElementBinPanel.tsx`,
  `ElementNotesPanel.tsx`, `app/constellation/new/page.tsx`. 이 4개는 상호작용 로직 덩어리다.
  className·색·크기 상수는 바꿔도 되나 이벤트 핸들러, 좌표 계산, 상태 배선은 손대지 말 것.

## 3. 절대 규칙 (어기면 기능이 깨진다 — 전부 실제로 겪은 버그)

1. **SVG에서 투명한 채움은 `fill="none"`이 아니라 `fill="transparent"`**.
   `none`은 클릭 판정에서 제외된다. 실제로 미달성 노드가 클릭 불능이 된 사고가 있었다.
2. **더블클릭 핸들러는 노드 `<g>`에 있다.** 자식 원으로 내리면 유효 클릭 영역이 좁아져
   "달성이 안 된다"는 버그가 재발한다.
3. **배경 장식은 전부 `pointer-events: none`** + 그래프 뒤 레이어. 팬/드래그를 가로채면 안 된다.
4. **배경에 상시 애니메이션 금지.** 모션은 의미 있는 곳(발광 엣지, 호버 위성)에만 쓴다는 것이
   하우스 룰. 7,109개 과목이 실리면 프레임 비용도 실제 문제가 된다. 예외는 세 가지:
   (1) 팬 제스처가 유발하는 비문증 드리프트(§1의 SpaceBackdrop 행) — 에너지가 있을 때만 rAF가
   돌고 정착하면 루프가 끊겨 유휴 비용이 0이다.
   (2) 배경 별의 `starTwinkle`(SpaceBackdrop.tsx) — 별마다 순수 CSS 애니메이션(`opacity`만
   흔든다)으로 상시 재생된다.
   (3) 달성 노드의 `spikeBreathe`(ConstellationCanvas.tsx, 십자 회절 스파이크) — 마찬가지로
   `opacity`만 흔드는 순수 CSS 애니메이션.
   (2)·(3)은 rAF가 아니라 CSS 애니메이션이므로 (1)과 달리 **유휴 비용이 0이 아니다** — 별/달성
   노드 개수만큼 상시 재생되는 GPU 합성 레이어가 늘 존재한다(다만 `opacity` 단일 프로퍼티라
   레이아웃/페인트를 다시 유발하지는 않는다). 이 세 가지 외에 새 상시 모션을 추가하지 말 것.
5. **`prefers-reduced-motion` 존중.** 새 애니메이션을 넣으면 반드시 이 미디어쿼리로 끌 수 있어야 한다.
6. **`font-mono`(IBM Plex Mono)를 한글에 쓰지 말 것.** 한글 글리프가 없다. 학정번호·숫자 전용.
7. **키보드 접근성 유지**: 포커스 링을 제거하려면 대체 표시를 넣을 것. 노드는 Tab 도달
   + Enter 선택, 캔버스 조작엔 전부 키보드 경로가 있다.
8. **`Delete`/`Backspace`는 캔버스 노드 삭제에 바인딩**되어 있고 텍스트 입력 중엔 무시된다
   (`isTypingTarget` 가드). 새 입력 요소는 네이티브 `input`/`textarea`로 만들어야 이 가드가 통한다.
9. **패널은 그래프 위에 떠 있는 오버레이**다(전체화면 캔버스가 바닥). 그리드 컬럼으로 바꾸면
   좌표 변환이 어긋난다.

## 4. 알려진 부채 (외주 전에 정리 권장)

- ~~유형→색 매핑이 3곳에 복사돼 있다~~ → **해소됨(2026-08-27)**: `frontend/lib/element-colors.ts`가
  단일 진실 공급원. 세 컴포넌트 모두 여기서 import한다. 유형 색을 바꿀 땐 이 파일(+ §1의
  globals.css/tailwind hex)만 보면 된다.
- `tailwind.config.ts`와 `globals.css`의 hex 이중화(§1 참고)도 같은 성격의 함정.

## 5. 참고 자료

- 기존에 받은 시안 번들: `C:\Users\user\Desktop\별자리 로드맵 UI 개선\design_handoff_constellation_roadmap\`
  — 이 중 우측 패널의 군집/노트 세그먼트 탭만 채택됐고 나머지 팔레트는 반려됨.
- 제품 컨셉: 별자리는 별이 아니라 **잇고 이름 붙이는 행위**. 학생은 게임 플레이어가 아니라
  자기 진로의 제도사. 만화·게임적 장식(마스코트, 일러스트) 금지 — 이전 콩나무 버전에서 전부 걷어냈다.
- 검증 명령: `cd frontend && npx tsc --noEmit && npx next lint`
  (⚠️ dev 서버가 떠 있는 동안 `next build` 실행 금지 — `.next` 캐시가 깨진다)
