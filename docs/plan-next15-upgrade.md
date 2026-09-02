# 계획: next 14.2.35 → 15.5.16 업그레이드 (보안 감사 DEP-1)

> 상태: **탐색 완료·사용자 승인 대기**. 작성 2026-09-02, 프론트엔드 세션.
> 근거: 보안 감사 2026-09-02 §3 DEP-1(High) — standalone `node server.js`의
> WebSocket 업그레이드 핸들러 SSRF(GHSA-c4j6-fc7j-m34r), 14.x 백포트 없음.
> 즉시 완화(최소권한 SA)는 백엔드 세션 담당 — 이 계획은 근본 수정.

## 1. 탐색 결과 — 영향 조사 (2026-09-02 실측)

| 항목 | 현황 | 판정 |
|---|---|---|
| 동적 세그먼트 6개 | 5개(`community/post/[postId]`, `community/[boardId]`, `constellation/[cid]`, `post/[postId]`, `login`)는 전부 `"use client"` + `useParams()`/`useSearchParams()` **훅** | **무영향** (훅 API는 15에서 동기 그대로) |
| `profile/[id]/page.tsx:185` | **유일한 예외** — client 컴포넌트가 `params`를 **prop**으로 받음(`{ params: { id: string } }`). 15에서 params prop은 Promise | **수정 1건**: `useParams<{ id: string }>()`로 전환(형제 페이지 5개와 같은 패턴으로 통일 — `React.use()` 언랩보다 일관적) |
| 서버 컴포넌트 페이지 | `feed/page.tsx`, `privacy/page.tsx` 2개뿐, 둘 다 params/searchParams 안 받음 | 무영향 |
| middleware / route handlers / generateMetadata / generateStaticParams | **전무** | 무영향 |
| React 19 | Next 15 App Router는 react/react-dom 19 필요 | `react`·`react-dom`·`@types/react`·`@types/react-dom` → 19 동반 범프 |
| `framer-motion ^12.42.2` | 12는 React 19 지원 | 저위험, 그대로 |
| `@opennextjs/cloudflare ^1.15.1` | `next.config.mjs:16` **모듈 최상단 import** — 비호환이면 빌드 자체가 깨짐 | 같은 PR에서 최신으로 범프(1.x가 Next 15 지원 — 설치 후 실확인) |
| `eslint-config-next` 14.2.35 고정 | 15.5.16으로 해제. `eslint ^8` 유지 가능 여부 설치 후 확인(15는 ESLint 9 권장 — 8 잔류가 경고면 수용, 에러면 9 동반 범프) | 확인 항목 |
| `next lint` | 15에서 유지(16에서 제거 예정) | 무영향 |
| `output: "standalone"` / `distDir` env | **절대 제거 금지**(사용자 상시 지시) — 15에서 동일 지원 | 그대로 |
| useSearchParams Suspense 요건 | 14에서도 동일 요건, 현재 빌드 통과 중 | 무영향 |

**결론: 코드 수정은 사실상 `profile/[id]` 1파일 + package.json.** 위험의 중심은
코드가 아니라 **의존성 조합(React 19 × OpenNext × eslint)**과 빌드 검증이다.

## 2. 절차 (승인 후)

⚠️ **전제 — 이 리포는 배포가 작업 트리를 말아 올리고, 세션 여럿이 체크아웃
하나를 공유한다. 브랜치 전환은 다른 세션의 발밑을 바꾼다.** 그래서:

1. **`git worktree add ../next15-upgrade feature/next15-upgrade`** — 공유 트리를
   건드리지 않는 격리 사본에서 작업(브랜치 전환 아님). 완료 후 worktree 제거.
2. `npm install`(next@15.5.16, react@19, react-dom@19, @types/react@19,
   @types/react-dom@19, eslint-config-next@15.5.16, @opennextjs/cloudflare 최신)
   — **CLAUDE.md Hard Rule에 따라 설치 자체가 이 계획 승인에 포함되는 항목.**
3. `profile/[id]/page.tsx` → `useParams()` 전환(공식 codemod
   `next-async-request-api`는 표면이 1파일이라 수동이 더 작다).
4. worktree에서 `npx tsc --noEmit` + `npx next lint` + **`npx next build`**
   (worktree는 dist가 분리돼 있어 "dev 중 build 금지" 함정 비적용).
5. OpenNext 빌드 검증: `npx opennextjs-cloudflare build` 통과 확인
   (next.config.mjs 최상단 import가 깨지는지 여기서 판명).
6. 로컬 스모크: worktree에서 별도 포트 + 별도 NEXT_DIST_DIR로 dev 서버 →
   /demo/constellation 렌더·콘솔 에러 0 확인 후 즉시 종료.
7. 커밋(의존성 1 + 코드 1 분리) → main 트리로 머지 준비 상태에서 **배포 세션
   (03-code-43)에 인계** — 라이브 배포·스모크(핵심 플로우: 로그인, 캔버스 부트,
   LLM 대화 1턴, 발행)와 트래픽 전환/롤백 지휘는 배포 세션 몫.
8. 재게이트: 내장 `/security-review`로 diff 검사(감사 플로우 규약).

## 3. 롤백

- 머지 전: worktree 폐기로 끝(공유 트리 무접촉).
- 배포 후: Cloud Run 트래픽을 직전 리비전으로 전환(재빌드 불요) + 커밋 revert 2건.

## 4. 명시적 비범위

- CSP/HSTS 등 `headers()` 보안 헤더(감사 백로그 항목 — 별건).
- fast-xml-parser CRITICAL(devDependency 빌드 경로, 런타임 미적용 판정).
- Next 16 (App Router 변경 폭이 크고 DEP-1 해소에 불필요).
