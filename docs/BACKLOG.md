# Backlog

미뤄둔 결정과 알려진 제약을 모아둔다. 완료된 일은 git 로그와
`docs/superpowers/plans/`가 기록하므로 여기에 남기지 않는다.

마지막 갱신: 2026-08-13 (프론트엔드 디자인 오버홀 완료 시점)

## 결정 필요

- **넓은 화면에서의 본문 폭** — 본문 상한이 `max-w-5xl`(1024px)이라 1920px 화면에서 좌우가 각 ~440px 빈다.
  "읽기 좋은 고정 폭"이 원래 의도였는데, 넓은 화면을 더 채우려면 상한을 1280~1440px로 올려야 한다.
  올릴 경우 피드 그리드 열 수(`app/page.tsx`의 `xl:grid-cols-4`)도 같이 손봐야 카드가 과하게 넓어지지 않는다.

## 알려진 제약

- **1280~1439px 구간의 98px 우측 치우침** — `components/shell/AppShell.tsx`의 균형추를 `min-[1440px]`부터
  켠다. 그 아래에서 켜면 레일 2개분(196×2)이 본문 폭을 갉아먹어 1024px를 못 채우기 때문(196×2 + 1024 = 1416).
  본문 폭 상한 결정이 나면 이 임계값도 함께 조정할 것.
- **남은 이모지** — 기록 모달의 🌼/🤍(좋아요)·💬(댓글 수), 랭킹의 🥇🥈🥉. `components/ui/icons.tsx`에
  대응 아이콘이 없어 남겼다. 아이콘을 추가하면 교체 가능. 아바타 이모지는 사용자 콘텐츠라 교체 대상이 아니다.
- **ANTHROPIC_API_KEY 만료** — 실제 LLM 경로(웹서치·딥리서치 포함)는 키 재발급 전까지 검증할 수 없다.
  UI·회귀 검증은 Mock LLM으로 대체한다.
- **pytest `SAWarning`(커넥션 미반납)** — 121개 전부 통과하지만 경고가 남는다. `CLAUDE.md`에 적힌
  "healthcheck 수준을 넘어서면 per-test transaction rollback fixture로 이행" 항목과 같은 뿌리다.

## 로컬 환경 메모

- **Mock LLM 기동**: `$env:ANTHROPIC_API_KEY = "mock-no-real-key"` 를 넣고
  `.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`.
  PowerShell에서 `= ""` 는 값을 비우는 게 아니라 **변수를 삭제**해서 `.env`의 만료 키가 되살아난다(401 → 503).
- **Windows 빌드**: dev 서버를 켜둔 채 `npm run build` 하면 `.next` 충돌로 `Failed to collect page data`가 난다.
  빌드 전에 dev를 먼저 내릴 것.
- **개발 DB 테스트 계정**: `goldenpath1` (user id 2754, 연세 인증 완료, 콩나무 2그루). 골든 패스 재실행용으로 유지.
- **브라우저 확인**: Claude가 원격 조종한 Chrome 창에는 뷰포트 에뮬레이션이 남을 수 있다.
  눈으로 볼 때는 별도의 Chrome 창을 직접 열 것.
