---
version: 1
slug: "frontend-app-page-tsx"
primary_target: "frontend/app/page.tsx"
related_targets: ["frontend/components/TelescopeLanding.tsx"]
---

# Surface: / (비로그인 랜딩 — 망원경 진입)

- Mode: Persuade. 방문자(연세대 무전공 1~2학년, 비로그인)가 "망원경 들여다보기" 단 하나의
  행동을 하게 만든다.
- Audience/job: 진로 불안을 안고 처음 들어온 학생. 행동 = CTA 클릭 → 진입 플로우.
- Direction (user-pinned): 승인 디자인 캔버스 시안(아티팩트 88238bcc 보드 1·2) —
  밝은 종이 성도(--paper-* 토큰), 선·여백만, Gowun 헤드라인 "흩어진 점들을 이으면, 나만의
  별자리가 된다.", 우측 미완성 별자리 선화. **랜딩은 반드시 밝은(흰) 지면**(사용자 재확인).
- Memorable moment: CTA 클릭 시 접안렌즈 원이 화면을 덮는 명→암 전환(apertureOpen 650ms,
  reduced-motion이면 즉시) → /constellation/new 착지.
- Constraints: 색은 globals.css --paper-* 인라인 var()로만(신규 Tailwind 토큰은 dev 서버
  재시작 전 미컴파일 — 실사고). 로그인 사용자는 이 서피스를 보지 않는다(소셜 자리 유지).
  일러스트·마스코트·소셜프루프 조작 금지. z-[60] (탭바 위).
- Resolved (2026-08-28): 로그인 사용자용 `/`는 이제 별자리 소셜 피드다(`GET
  /api/constellations/feed` 카드 그리드, `MiniConstellation` 미리보기 - 상세 페이지가
  아직 없어 카드는 링크가 아니다). 비로그인 방문자는 이 파일 상단의 랜딩 계약을 그대로 본다.
- Unresolved: 접안렌즈 전환의 역방향(캔버스→랜딩) 연출은 미정. 피드 카드 클릭 시 이동할
  별자리 상세 페이지가 생기면 카드를 링크로 승격할 것.
