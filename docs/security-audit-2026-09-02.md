# 내부 보안 감사 보고서 — 2026-09-02

> **상태: 사용자 승인(2026-09-02 18:40, "너가 하려는 대로 해 / 프론트세션 깨워") → 수정 위임 완료, 구현 대기.** 감사 세션(03-code-f0, 구 03-code-b0)은 소스를 수정하지 않는다.
> - 백엔드·인프라 세션(03-code-b3, 구 03-code-43): §6 #1(규칙 차단, 선택 1' 포함 여부는 그쪽 판단) → #2(최소권한 SA) → #5(로그) → #6(starlette 핀). 착수 확인됨(`firestore.rules` 편집 중).
> - 프론트 세션("프론트엔드 작업", CCD 메시지로 깨움): #4(markdown 스킴, 즉시) → #3(Next 15.5.16, 계획 먼저·사용자 승인 후 착수).
> - 감사 세션: #8 완료(`f403f5f`). 각 수정 커밋이 보고되면 내장 `/security-review`를 그 diff에 실행해 §7에 기록.
> 재개 지점: §7이 비어 있으면 소유 세션의 커밋 보고를 기다리는 중.

## 0. 방법

- 도구: `anthropics/claude-code-security-review`는 플러그인이 아니라 GitHub Action + `security-review.md` 커맨드 파일. `/security-review`는 Claude Code 내장(변경분 전용). 그 파일을 전체 리포 감사용으로 개조해 `.claude/commands/security-audit.md`로 커밋(`dd32c2f`).
- 흐름: 위협 모델 → 결정론 사전검사(npm audit·pip-audit·gitleaks 8.30.1) → 영역 5개(A 인증·인가 / B Firestore·Storage 규칙 / C LLM 경로 / D 비밀·인프라 / E 프론트 렌더·업로드) 병렬 발견(Sonnet) → finding마다 적대적 검증(Opus, 신뢰도 8 미만 탈락) → HIGH는 격리 에뮬레이터에서 실제 요청으로 재현 → 본 보고서 → 사용자 선택 → 항목당 커밋 1개 + 회귀 테스트 → 내장 `/security-review`로 재게이트.
- 제약: 라이브(Cloud Run) 능동 스캔 없음. 재현은 별도 Firestore 에뮬레이터(포트 8901, 프로젝트 `demo-ourlab-test`, import 없음)에서만 수행 후 종료. 공용 에뮬레이터·dev 서버·`demo-ourlab` 데이터 무접촉.
- 거짓양성 사전 목록: 두 세션이 확인한 의도적 설계 12건(`allow_credentials`+Origin 검사, 익명 읽기 3계층, 쪽지 `from_role` 익명성, `check_revoked=False`, `/demo` 비인증, sessionStorage 초안, hex 색, EyeDropper 등)은 finding에서 제외.
- 원본 자료(세션 스크래치패드 `C:\Users\user\AppData\Local\Temp\claude\C--Users-user-Project-CareerCompass-03-Code\09399407-5891-46fa-907b-06a1f4768dff\scratchpad\findings\`): `A,B,C,D,E,PRESCAN.md`, `B1-VERDICT.md`, `VERDICT-C1-E1.md`, `REPRO-B1.txt`.

## 1. 요약

| ID | 심각도 | 신뢰도 | 재현 | 위치 | 한 줄 | 소유 |
|---|---|---|---|---|---|---|
| **B-1** | **High** | 9/10 | ✅ 에뮬레이터 재현 | `firestore.rules:36-44` | 로그인만 한 미인증 사용자가 Firebase SDK/REST로 `constellations` 문서를 직접 생성·게시 → 백엔드 `require_yonsei_verified` 우회, 익명 `GET /api/constellations/{id}`·`/user/{uid}`로 서비스 도메인에서 서빙 | 인프라(03-code-43) |
| **DEP-1** | **High** | 7/10 | 코드 경로 확인(인그레스 정규화 여부만 미검증) | `frontend/package.json` next@14.2.35 | 자체 호스팅 standalone 서버의 WebSocket 업그레이드 핸들러가 절대경로 요청 호스트로 프록시(SSRF, GHSA-c4j6-fc7j-m34r). 프론트 Cloud Run이 **기본 compute SA(Editor)** → 메타데이터 토큰 탈취 시 프로젝트 전체 위험. 14.x 패치 없음 | 프론트(03-code-b7) + 인프라(03-code-43) |
| B-1b | Low | 9/10 | ✅ 재현 | `firestore.rules:72-76` | 규칙은 문서 ID 접두사만 검사, 백엔드는 `follower_id`/`followee_id` **필드**를 조회 → 제3자 간 팔로우 간선 위조(그래프 오염, DM 승격 불가) | 인프라(03-code-43) |
| C-1 | Low | 7/10 | 코드 확인 | `backend/app/services/course_clustering.py:169-173,198-202` | 사용자 목표 텍스트 80자를 WARNING 로그로 Cloud Logging에 남김(PIPA 위생, 삭제 경로 밖) | 백엔드(03-code-43) |
| E-1 | Low 현재 / High 잠재 | 3/10 현재 | 코드 확인 | `frontend/lib/markdown.tsx:164-176` | `[text](url)` href 스킴 허용목록 없음 → `javascript:` 링크. 지금은 작성자 본인 캔버스에서만 렌더(self-XSS), `is_public` 노트 뷰어가 생기면 stored XSS | 프론트(03-code-b7) |

영역 A(인증·인가)·D(비밀·인프라)는 신뢰도 0.7 이상 finding 없음. 비밀: git 히스토리 실비밀 0건(gitleaks 전수, 공개 Firebase 웹 키 2건뿐), `.env`류 커밋 이력 없음. starlette·python-multipart·pydantic-settings·fast-xml-parser 권고는 전부 **미적용**으로 판정(§4).

## 2. B-1 상세 — Firestore 규칙이 `yonsei_verified`를 검사하지 않음

**근거 체인** (Opus 검증, file:line)
1. 공격자 계층 2 존재: `frontend/app/signup/page.tsx:41` 이메일 형식만 검사, `lib/auth-context.tsx:117` `createUserWithEmailAndPassword`. `yonsei_verified`는 `backend/app/auth/firebase_auth.py:213-221`(yonsei.ac.kr + 이메일 인증) 또는 학생증 수동 승인으로만 부여.
2. Firebase 웹 설정은 번들에 공개(`frontend/Dockerfile:21-30`, 정상), App Check 없음 → 브라우저 밖에서 SDK/REST로 Firestore 직접 접근. 규칙 헤더(`firestore.rules:5-10`)도 "규칙이 유일한 경계"라고 명시.
3. `firestore.rules:36-44`는 `isSignedIn()` + `owner_id == request.auth.uid`만 검사. `request.auth.token.yonsei_verified`는 파일 어디에도 없음.
4. 노출 경로(정정): 전역 공개 피드 `list_published`(`constellation_repo.py:263`)는 호출자 0인 죽은 코드. 실제 노출은 **익명 허용** `GET /api/constellations/{id}`(`constellation.py:167-181` → `_get_owned_or_published` :97-111)와 `GET /api/constellations/user/{uid}`(:150-165). 역직렬화는 장벽 아님: 필수 필드 6개뿐(`domain/constellation.py:169-215`). `contributors: list[str]`에 실제 학생 uid 삽입 가능.
5. FastAPI를 거치지 않으므로 레이트리밋·Pydantic 검증 모두 없음.

**재현** (격리 에뮬레이터 8901, 미서명 JWT로 `attacker1` 시뮬레이션 — `REPRO-B1.txt`)

| 테스트 | 현재 규칙 | 수정 규칙 |
|---|---|---|
| 미인증 사용자가 `is_published=true` constellation 생성 | **200 (취약)** | 403 |
| `follows/attacker1_x`에 `{follower_id: victimA, followee_id: victimB}` | **200 (취약)** | 403 |
| 대조: `owner_id`를 타인으로 생성 | 403 | 403 |
| 익명 읽기 | 403 | 403 |
| 본인 문서·게시된 타인 문서 읽기 | 200 | 200 (읽기 유지) |
| Admin SDK(`Bearer owner`) 쓰기 | 200 | 200 (백엔드 무영향) |

**수정안** (규칙 파일만, `firebase deploy --only firestore:rules`, `docs/deploy.md:264`)
- `constellations`: create/update/delete 세 규칙을 `allow write: if false;`로 교체(읽기 유지). 프론트는 `firebase/auth`만 import(`lib/firebase.ts:2`), Firestore 쓰기는 전부 Admin SDK `constellation_repo`(규칙 우회). 클레임 검사 추가안보다 diff가 작고, `deps.py:74-106`의 stale 클레임 라이브 조회를 규칙이 못 하는 문제를 피하며, 인증된 소유자가 SDK로 스키마를 우회하는 백로그까지 닫힘. 같은 파일에서 4회 쓰인 패턴.
- `follows`: 동일하게 `allow write: if false;`(팔로우는 `/api/profiles/{uid}/follow` 경유, 카운터 트랜잭션 보존).
- 선택: `users/{uid}` 쓰기도 차단(`PATCH /api/profiles/me` 경유; SDK 직접 쓰기는 `interest_tags`/`follower_count` 자기 조작 가능).
- 깨지는 것 없음(시드·ETL·`restore_emulator.ps1` 모두 규칙 아래 경로). 향후 비용: 클라이언트 `onSnapshot` 실시간 구독 시 규칙 재개방 필요.
- 회귀 테스트: 위 표를 에뮬레이터 규칙 테스트로 고정(`REPRO-B1.txt`의 REST 시퀀스를 스크립트화, 새 의존성 불필요).

## 3. DEP-1 상세 — Next 14.2.35 자체 호스팅 WebSocket SSRF

- `frontend/node_modules/next/dist/server/lib/router-server.js:441-489` standalone `upgradeHandler`: HMR 분기는 `opts.dev` 게이트(:452) 안이지만 `proxyRequest` 호출(:484)은 게이트 밖 → 프로덕션 `node server.js`에서 실행. `resolve-routes.js:81`은 `url.parse(req.url)`로 요청 라인의 `protocol`을 그대로 취함 → `GET http://169.254.169.254/... HTTP/1.1` + `Connection: Upgrade`면 rewrites 없이도 프록시. 권고문의 "안전한 외부 rewrite만 프록시"는 **패치 후** 상태.
- Cloud Run 컨테이너는 메타데이터 서버 도달 가능(ADC가 그 경로). `Metadata-Flavor: Google` 헤더는 공격자 요청에서 그대로 전달. `docs/deploy.md:215`는 `--service-account` 없이 배포 → **기본 compute SA(프로젝트 Editor)**. `docs/deploy.md:6` 직접 run.app URL, `--allow-unauthenticated`, 앞단 CDN/LB/WAF 없음.
- 미검증 1건: Google Front End가 절대경로 요청 타깃(HTTP/1.1) 또는 비경로 `:path`(HTTP/2)를 컨테이너에 그대로 넘기는지. 컨테이너 쪽은 전부 확인됨. 반증 전까지 High.
- 치료: 14.x 백포트 없음(`npm view next dist-tags`: next-14 = 14.2.35 종단). **`next@15.5.16` + `eslint-config-next@15.5.16`**. 예상 파급: React 19 필수, 동적 세그먼트 6개 파일의 `params`/`searchParams` Promise화 감사(`community/post/[postId]`, `community/[boardId]`, `constellation/[cid]`, `post/[postId]`, `profile/[id]`, `login`; `"use client"`+`useParams()`면 무영향), `@opennextjs/cloudflare`는 `next.config.mjs:16` 모듈 최상단 import라 빌드 자체가 깨질 수 있어 같은 PR에서 범프, framer-motion 12는 저위험.
- 즉시 완화(업그레이드 전): ① 프론트 Cloud Run을 **전용 최소권한 SA**로 재배포(`--service-account`, 다음 배포 시 플래그 1개) → 최악의 경우를 프로젝트 전체에서 단일 서비스로 축소. ② 앱이 WebSocket을 쓰지 않으므로 앞단에서 `Upgrade` 헤더를 떨어뜨리면 핸들러 자체가 닫힘.

## 4. 의존성 판정 (Opus)

| 항목 | 적용 | 신뢰도 | 근거 | 조치 | 소유 |
|---|---|---|---|---|---|
| next DoS 계열 7건 | 백로그 | — | 감사 규칙 제외. `--max-instances 3`라 비용 상한. 같은 업그레이드로 해소 | DEP-1과 동일 | 프론트 |
| next 캐시 오염 5건 | 백로그 | — | 앞단 공유 캐시 없음, 인프로세스 캐시 ≤3개 | 동일 | 프론트 |
| starlette 1.0.0 (PYSEC-2026-161/248/249/2280/2281) | **아니오** | 9~10 | `backend/app`에 `request.url`·`url_for`·`RedirectResponse`·`StaticFiles`·`HTTPEndpoint`·폼 파싱 0건(유일한 `UploadFile`은 미등록 `auth.py:367`). Cloud Run이 Host로 라우팅. 2281은 Windows 전용 | 위생: `pyproject.toml`에 `"starlette>=1.3.1"` 1줄(fastapi 0.136.1은 `starlette>=0.46.0` 상한 없음) | 백엔드 |
| python-multipart 0.0.27 | 아니오 | 9 | `fastapi[standard]`가 끌어올 뿐, 등록 라우트가 파서에 도달 안 함 | 선택 `>=0.0.31` | 백엔드 |
| fast-xml-parser CRITICAL | 아니오 | 9 | `@opennextjs/cloudflare`는 devDependencies(`package.json:22`); Dockerfile 러너 스테이지는 standalone만 복사(:35-42); `next.config.mjs:16` import는 빌드 시 평가 | 다음 Cloudflare 작업 때 갱신 | 프론트 |
| pydantic-settings | 아니오 | 10 | `secrets_dir`/`NestedSecretsSettingsSource` 0건 | 없음 | — |
| urllib3 2.6.3 / idna 3.13 | 백로그 | — | 클라이언트 역할, 목적지는 Google·Anthropic만 / DoS 계열 | 기회 시 범프 | 백엔드 |
| 백엔드 lock 파일 없음 | 백로그 | — | 빌드마다 버전 드리프트, 핀이 유지 안 됨 | lock 도입 | 백엔드 |

## 5. 나머지 finding과 백로그

**C-1**: 클러스터 0개/학과 0개 fallback에서 `goal_text[:80]` WARNING. 로깅 설정 없음 → stderr → Cloud Logging. `frontend/app/privacy/page.tsx`는 목표 텍스트 로깅 미고지, 탈퇴 시 삭제 약속하지만 로그는 삭제 경로 밖. 같은 텍스트가 게시 시 공개되므로 Low. 수정: 텍스트는 `logger.debug`, WARNING에는 길이·건수만. 인접: `email/resend_sender.py:60-77` 수신자 이메일 로그.

**E-1**: `<a href={match[3]} target=_blank rel=noreferrer noopener>` 스킴 검사 없음, 클릭 핸들러가 막지 않음(`ElementNotesPanel.tsx:991-995`). Markdown은 `ElementNotesPanel.tsx:34`에서만 import, 그 패널은 `app/constellation/new/page.tsx:22`에서만 사용. `GET /{cid}/notes`는 소유자 아니면 예외(`note_repo.py:194-200`), `is_public`은 쓰기만 되고 읽히지 않음. 정정: `local-vault.ts` 공유 폴더 노트가 같은 목록에 합쳐져 엄밀히 자기 작성만은 아님(원격 아님). 수정(4줄, 지금 반영 권장): `SAFE_HREF=/^(https?:|mailto:)/i`, 제어문자 제거 후 불일치면 라벨을 평문으로.

**백로그** (취약점 아님)
- D: 프론트 보안 헤더(CSP/HSTS/X-Frame-Options/Referrer-Policy) 전무 → `next.config.mjs` `headers()`.
- D: `create_app()` fail-fast 가드 — `APP_ENV=production`인데 `FIREBASE_AUTH_EMULATOR_HOST`/`FIRESTORE_EMULATOR_HOST`가 있으면 기동 거부(firebase_admin 미서명 토큰 전환 함정, `firebase_auth.py:17-26`). `cookie_secure` 기본값 문제도 같은 가드로 해결.
- D: 프로덕션 `/docs`·`/openapi.json` 노출(`main.py:34-38`).
- D: 죽은 설정 `OPENAI_API_KEY`·`SOLAPI_*`(`.env.example`, `deploy.md`) / `firebase.json` hosting rewrite / `SECRET_KEY`.
- B: `storage.rules` `student_cards`가 `image/svg+xml` 허용 — 현재 쓰는 곳·읽는 곳 없는 죽은 경로. 연결 시 jpeg/png/webp 제한.
- B: `users/{uid}`의 `consent_at`이 로그인 사용자 전체에 읽힘(Low).
- C: `synthesize_roadmap`/`extract_intent`/`select_ncs_job`/`research_job` 구현돼 있으나 등록 라우터 없음 — 의도적 휴면인지 확인. `preview_jobs.py`는 없고 `bin_jobs.py`가 실체.
- C: Anthropic 무보존·비학습 진술이 `docs/`에 없음 → PIPA 국외이전 고지(기지)에 포함.
- A: 인메모리 레이트리밋 / 계정 삭제 구 FastAPI+Postgres 의존 / data.go.kr 키 히스토리 잔존(공개 전환 전 재발급+히스토리 정리).
- 사용자 승인 트레이드오프(재확인만): 데모 계정 공유 비밀번호 문서 평문, `seed_demo_data.py:41` `demo1234`(격리 데모 DB).
- 감사 커맨드 정정: `.claude/commands/security-audit.md` Area E의 "uses `dangerouslySetInnerHTML`"은 오류(리포 grep 0건). 다음 커밋에서 수정.

## 6. 수정 대기 목록 — 사용자 선택

| # | 항목 | diff | 회귀 테스트 | 소유 |
|---|---|---|---|---|
| 1 | **B-1 + B-1b** `firestore.rules` constellations·follows 클라이언트 쓰기 차단 + 규칙 배포 | 2블록 → 2줄 | 에뮬레이터 규칙 테스트(§2 표) | 03-code-43 |
| 1' | (선택) `users/{uid}` 쓰기 차단 | 1줄 | 동일 | 03-code-43 |
| 2 | **DEP-1 완화 ①** 프론트 Cloud Run 전용 최소권한 SA로 재배포 | 배포 플래그 1개 | 배포 후 스모크 | 03-code-43 |
| 3 | **DEP-1 치료** next 15.5.16 업그레이드(React 19, 동적 라우트 6개 감사, opennext·eslint-config 동반) | 메이저, 별도 브랜치·계획 | 빌드 + 라이브 스모크 | 03-code-b7 |
| 4 | E-1 `markdown.tsx` 링크 스킴 허용목록 | 4줄 | `runMarkdownSelfCheck()` assert | 03-code-b7 |
| 5 | C-1 `course_clustering.py` 로그에서 목표 텍스트 제거 | 2줄 | caplog 테스트 | 03-code-43 |
| 6 | starlette≥1.3.1 (+python-multipart≥0.0.31) 핀 | 1~2줄 | pytest | 03-code-43 |
| 7 | 백로그 저비용 3건: 보안 헤더, 에뮬레이터 env fail-fast, `/docs` 프로덕션 비활성 | 각 5~10줄 | curl 헤더 / 기동 테스트 | 03-code-b7 / 03-code-43 |
| 8 | 감사 커맨드 문구 정정 | 1줄 | — | 03-code-b0 |

권장 순서: 1 → 2 → 4 → 5 → 6 → 3(별도 계획) → 7. 선택되면 감사 세션이 finding+수정안+사용자 지시 원문을 각 소유 세션에 전달 → 소유 세션이 구현·커밋 → 배포 차수는 03-code-43 지휘 → 수정 diff에 내장 `/security-review` 실행 결과를 §7에 기입.

## 7. 재게이트 결과 (2026-09-02 19:20 기준)

내장 `/security-review` 방법론(변경분 전용, 신뢰도 0.8 이상만)을 수정 커밋 범위에 적용 + B-1은 격리 에뮬레이터에서 재현 스크립트 재실행.

| 커밋 | 항목 | 판정 | 근거 |
|---|---|---|---|
| `7aacdef` | B-1/B-1b/1' `firestore.rules` constellations·follows·users 클라이언트 쓰기 차단 | **PASS** | 읽기 규칙 불변(:31-34, :51, :72), 다른 match 블록 바이트 동일, 기본 거부 catch-all 유지(:129-131). 프론트에 `setDoc`/`updateDoc`/`addDoc`/`deleteDoc` 호출 0건. **에뮬레이터 재검증**: 미인증 생성 403, 팔로우 위조 403, users 자기쓰기 403, Admin 쓰기 200, 게시 문서 읽기 200, 익명 읽기 403(`REPRO-B1.txt` RE-GATE 블록) |
| `545e305` | DEP-1 완화 프론트 Cloud Run 전용 SA(`ourlab-frontend-runtime@ourlab-0808`) | **PASS(노트)** | `deploy.md:215` `--service-account` 추가. 프론트는 GCP API 호출 0건이라 무권한 SA로 무영향. **노트**: SA 생성(`gcloud iam service-accounts create ...`) 단계가 문서에 없어 SA 존재·역할 0 상태를 리포만으로 검증 불가 → 백엔드 세션이 라이브에서 확인하고 문서에 생성 단계 추가 요청 |
| `90cfd5a` | C-1 `course_clustering.py` 로그 | **PASS** | WARNING 두 곳(:172-176, :203-207)은 `len(goal_text)`만, 원문은 `logger.debug`(:177, :208)로. 테스트 `test_cluster_courses_empty_result_warning_omits_goal_text`가 WARNING 이상에서 sentinel 부재 assert. 클러스터링 로직 무변경 |
| `d3c3a9d` | E-1 `markdown.tsx` 링크 스킴 허용목록 | **PASS** | `SAFE_HREF_RE=/^(https?:\|mailto:)/i`(:126), `safeLinkHref`가 `[ - ]` 제거 후 검사(:130-133), 불일치는 평문(:217), `rel="noreferrer noopener"` 유지(:210). 셀프체크 10케이스(`javascript:`, 대소문자 변형, 탭 삽입, `data:`, `vbscript:`, `//` 포함). 커밋 파일에 리터럴 제어 바이트 0 확인 |
| `5e0ed22` | §6 #6 `pyproject.toml` `starlette>=1.3.1`, `python-multipart>=0.0.31` | **PASS** | §4 판정과 일치, 근거 주석 포함. fastapi 범프 없음 |
| `1a22ca3` | C-1 테스트 보강 | **PASS** | 학부 후보가 있는데 군집 0개를 내는 스텁으로 실제 경고 분기를 태움(기존 6000단위 입력은 조기 리턴이라 경로를 못 타던 문제 수정) |
| — | Next 15.5.16 업그레이드 (§6 #3) | 진행 중 | 프론트 세션이 사용자 승인 후 격리 worktree에서 착수(`docs/plan-next15-upgrade.md`). 완료 시 그쪽 `/security-review` 결과를 여기 추가 |

새로 도입된 취약점: 없음.

**라이브 반영 상태 (백엔드 세션 보고, 2026-09-02 19:30)**
- **B-1 닫힘**: `7aacdef` 직후 `firebase deploy --only firestore:rules --project ourlab-0808` 완료. 운영 규칙 = 재게이트한 커밋본. 배포 후 라이브 스모크(별자리 4건 조회·게시판 6개) 정상.
- **DEP-1 완화 적용**: `ourlab-frontend-runtime@ourlab-0808` 라이브 검증 — `describe` 활성, `get-iam-policy` 필터 결과 역할 0개, `run services describe`에서 `serviceAccountName` 적용 확인. 프론트 리비전 `ourlab-frontend-00020-44q`(재빌드 없는 `services update`), 스모크 `/`·`/demo`·`/login` 200. `545e305`의 노트는 `306f2a0`(deploy.md에 SA 생성 명령 + 역할 0 검증 명령 추가)로 해소.
- starlette: venv 실측 1.0.0 → **1.6.0**, `app.main` import 정상, 핵심 테스트 20통과.
- 백엔드 재배포(C-1 로그 + 핀 반영): 진행 중, 리비전 번호 추후 기입.

### 남은 백로그 (감사 종료 후 별건)
§5 목록 그대로 + 위 노트(SA 생성 단계 문서화). 다음 감사 때 `/security-audit`로 전체 재실행, 수정분은 내장 `/security-review`.
