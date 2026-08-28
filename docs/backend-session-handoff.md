# 백엔드 세션 핸드오프 (2026-08-27 작성, 2026-08-28 6차 갱신)

> **6차 (오후) — 사용자 6건 배치: 전환 무깜빡임 + 소셜/feed + 별·노드 시각 언어 + 종이 크롬**
> (커밋 `a6033b1`~`b5e6622` 8개, Playwright 실완주 검증 — 브라우저 패널 숨김 상태라
> preview 스크린샷 불가 → Playwright MCP로 대체한 것도 실측 기록):
> - **전환 깜빡임 해소** (`a6033b1`): 부트 4개 해소 지점에서 setIntakeOpen(true)을
>   setBootState와 **같은 동기 블록**에 배칭(별도 effect 삭제 — paint 후 1프레임 노출이
>   원인이었음) + bootState==="loading" 동안 z-[70] 불투명 베일("관측 준비 중…").
> - **소셜 네비** (`d7690f4`+`7e51221`): 증상 "소셜 누르면 처음으로" = href "/"가 비로그인
>   랜딩이었던 것. GET /feed는 get_current_user_optional(발행물은 공개, 익명 200 테스트 추가,
>   30 pytest 통과), 피드 UI를 FeedView.tsx로 추출 → /feed 신설(익명 열람), 네비 href=/feed.
>   로그인 홈("/")은 FeedView 재사용으로 불변.
> - **별 twinkle** (`f3b9721`): DIM 1/3+BRIGHT 전부, 시드 파생 per-star 주기(2.5~6s,
>   Math.random 금지 규약 유지), opacity-only. 실측: 336개 circle 개별 주기 확인.
> - **노드 상태 반전** (`b896dcf`): 미완료=분광형 색으로 **켜진** 별(0.75~0.85), 달성(더블클릭)=
>   더 밝게+const-glow+**십자 회절 스파이크**(rect 2개+gradient, spikeBreathe). 더블클릭 실측
>   aria-pressed/스파이크/애니메이션 확인. 엣지 lit 규칙 불변.
> - **종이 크롬** (`8c84bc2`): 방향 "관측 하늘 위 종이 성도 카드" — SideRail/TabBar/
>   ElementBinPanel/저장 툴바를 --paper-*로 전환. 활성 네비=잉크 눌림(bg-paper-ink),
>   포커스 링=paper-ink(.paper-surface 스코프 신설, 랜딩 규칙 재사용). DESIGN.md
>   Landing-Scope Rule → Floating-Chrome Paper Rule 개정, twinkle 예외 명기.
> - **검수·QA 후속** (`f7e7ed6`+`b5e6622`): ①툴바 fixed left-3가 불투명 종이 레일에 묻힘 →
>   md:left-[208px] ②초안 confirm 후 노드가 뷰 밖 → ConstellationCanvas에 fitRequest 토큰
>   prop(computeFitTransform, 부트 자동 센터도 동일 헬퍼) ③ElementNotesPanel 종이 전환
>   (전체화면 에디터는 잉크 유지 — 관측 표면) ④FeedView 한글 font-mono 위반 분리
>   ⑤design-handoff-guide §1·§3-4에 starTwinkle/spikeBreathe 상시 모션 예외 동기화
>   ⑥twinkle/spike delay를 음수로(마운트 후 '툭' 스냅 제거).
> - 시안 품질 질문 답: **mock이라 그런 것 맞음** — 실 LLM 전환은 launch `backend`+재기동만.
> - 미검증: 발행→피드 카드 노출(로그인 필요), 기존 별자리 배지(로그인+기존 문서 필요).
>   에뮬레이터는 pytest로 또 비워졌다가 22과목 재시드됨.

> **5차 (야간 마감) — 대화 우선 진입 + 전용 초안 스테이지** (`63226b4`, 브라우저 완주 검증):
> - 사용자 결정: /constellation/new 진입 시 **항상 대화부터**(기존 별자리 있으면 우상단
>   "별자리가 이미 있어요 · 이어서 편집" 배지로 탈출). 대화 완료 = **항상 새 별자리 시작**
>   (기존 문서 불변 — 완료 핸들러가 constellationId/ref까지 동기 리셋해 persistBins 오염 차단).
> - 초안 검토는 캔버스 위가 아니라 **DraftReviewStage.tsx 전체화면**(Cosmos 보드 재현:
>   별밭+배너+대형 라벨 별자리 프리뷰+좌하단 3안 패널). confirm → 캔버스로 그래프 이관.
>   계약: {drafts, selected, nodes, edges, bins, onSelect, onConfirm, onReject}.
> - **"수업이 안 나와요" 재발 방지**: 공유 에뮬레이터에 pytest 돌리면 conftest autouse가
>   DB 전체 삭제 → 시드 소멸. 복구=scripts/seed_emulator_courses.py 재실행. mock 학과 맵은
>   "데이터"도 커버함(응용통계·공대) — 시드만 있으면 수업 군집 정상.
> - `.next` 캐시 손상(Cannot find module './NNN.js') **근본 원인 규명·해결**: 두 세션의
>   dev 서버(3000/3001)가 같은 frontend/.next를 공유하며 청크를 상호 덮어씀. 프론트 세션이
>   `84fc57b`로 NEXT_DIST_DIR 분리(frontend-alt=.next-alt). **잔여 충돌원 1개 확인됨**:
>   서브에이전트의 검증 `npm run build`도 dev 서버와 같은 .next에 쓴다 → 이후 에이전트
>   브리핑에는 검증 빌드를 `$env:NEXT_DIST_DIR='.next-build'; npm run build`로 지시할 것.
>   그래도 500 뜨면 .next 삭제 후 재기동. 파이썬 백엔드는 핫리로드 없음 — 백엔드 커밋 후
>   반드시 backend-mock 재시작(구 코드가 구 초안 알고리즘을 서빙한 실사고).
> - **아침 수정 3건 완료·실측** (`a79cff3`+`2ad77bb`): ①초안 그래프 중앙 배치(26~90% 영역
>   정중앙 실측 835/1440) ②3안 MECE — 수업은 초안별 완전 분리(4/4/4), 지원 요소는 공유 고정,
>   실 LLM 프롬프트에도 동일 지시 ③SpaceBackdrop 드리프트 이식 + 드래그 팬(시차 연동,
>   합성 드래그 실측 translate 60,30 확인). side-tab 예외는 검수 채택 근거로 파일 한정 기록.
> - 야간 이관: 프론트 세션(03-code-7e)이 63226b4 기준 스테이지 **디자인 검수** 수행 예정
>   (기능 계약 불변 약속). 미검증 엣지 1건: 기존 별자리 보유 시 우상단 배지 시각 확인.
> - 실 LLM 전환은 launch.json `backend` 구성(실키 .env에 있음) — mock 정형 질문/이름이
>   실제 생성으로 바뀜.

> **2026-08-28 4차 — 시안 4보드 완전 구현 + 메인페이지 피드 + 익명 플로우**
> (커밋 `b6bbeb0`~`4a46b16`, 비로그인 상태로 렌즈→대화(칩)→혼합 초안→캔버스 실완주 검증):
> - **시안 정본**: 디자인 캔버스 아티팩트 `88238bcc` — 추출법: 아티팩트 HTML의
>   `<script id="appifact-doc">` JSON → content.files (Main/Aperture/Dialogue/Cosmos
>   .dc.html + canvas.json 주석). 카피·색·크기는 이 소스가 기준.
> - **보드 2** (`b6bbeb0`): TelescopeLanding 3단계 stage — CTA→접안렌즈 대기(640px 링+우주+
>   Q1/6 예고+캡션), **원 클릭만이 진행**, 확대는 scale0.18→1 단일 700ms.
> - **보드 3** (`620a3f0`+`090f8a3`): 전체화면 관측기록 대화 — 별 6개 진행점, 지난 문답 흐림,
>   Gowun 질문, **질문마다 칩 2~4개+힌트**(ChatTurn.hint/options — anthropic 스키마·mock 6문항
>   모두), 칩 클릭=입력 제출. 응답 경계에서 `?? []` 방어(`4a46b16`).
> - **보드 4** (`af07403`+`52ed56a`): 잡 결과 drafts 3안(name/tagline/itemIds/edges, 환각 방어)
>   → 캔버스 배너+추천 패널(3안 전환, 혼합 브레이크다운, 이 별자리로 시작/직접 그릴래요).
>   mock 초안은 수업 3~4+지원유형별 1개 혼합(`090f8a3`).
> - **익명 플로우** (`6584032`+`090f8a3`): 사용자 결정 "로그인 여부와 무관하게 플로우 동작,
>   제한은 나중에" — 인테이크 4개 라우트 get_current_user_optional, 익명 잡 소유 uid="anon"
>   (uuid4 잡 id라 추측 불가 — ponytail 주석), 비로그인도 /constellation/new에서 대화 자동 시작,
>   로그인 게이트는 저장 시점.
> - **메인페이지** (`137d0d6`+`94c3f81`): GET /api/constellations/feed(공개20+작성자 조인,
>   /{cid}보다 먼저 선언) + 로그인 홈=관측기록 피드(MiniConstellation 시그니처 문법, FIELD NOTE
>   서브라인). 카드는 아직 링크 아님(상세 페이지 없음).
> - **디자인 거버넌스**: DESIGN.md/PRODUCT.md/.impeccable(프론트 세션 산출)이 편집 훅으로 팔레트
>   드리프트를 잡음. 시안 원본 값은 ignore-value+사유로 기록(27/22/13.5px, #0b1024 등).
>   side-tab 두꺼운 좌측 바 금지 — 선택 강조는 옅은 배경+헤어라인.
> - **세션 조정**: 프론트 세션=피어 `03-code-7e`(SendMessage). 상호 회피 목록 운영, 공유 지반
>   globals.css(--paper-*·.telescope-landing=프론트 / apertureOpen·Reveal=백엔드)·tailwind는
>   통지 후 수정. TelescopeLanding 색은 인라인 var(--paper-*)만(신규 토큰은 dev 재시작 전
>   미컴파일), z: 랜딩60/스테이지65/줌70.
> - **환경 함정(반복 실증)**: 강제종료·사용량 중단 후 고아 프로세스(java:8080, node:3000)가
>   포트 점유 → preview 거부·낡은 청크 404·폼 무반응. netstat→PID kill이 정석. `.next` 캐시
>   손상(Cannot find module './NNN.js') → .next 삭제 후 재기동. 숨겨진 브라우저 패널은
>   애니메이션 클록 동결 — 타이밍 실측 불가, DOM 검증으로 대체. 에이전트 emulators:exec와
>   장기 에뮬레이터는 포트 충돌 — 살아있는 에뮬레이터에는 env로 직결이 안전.
> - **다음 후보**: 익명→로그인 시 로컬 그래프 이관(현재 익명 저장 클릭=로그인 유도만),
>   피드 카드 상세 페이지, mock 학과 매칭이 "데이터 분석가"류 목표에서 과목 군집을 못 만드는
>   케이스 개선(실 LLM은 무관), 실 LLM 스모크, S7 정리, 구 기능 마이그레이션, Storage 첨부.

> **2026-08-27 세 번째 세션 — C(군집 어드바이스) + D(진입 플로우) + 발행 완료**
> (커밋 `1a4fd85`~`20d393f` 13개, mock+에뮬레이터 브라우저 E2E 전 항목 통과):
> - **학칙 다이제스트**: `app/llm/academic_rules.py` 상수(27섹션 11.7K자, 수치 원문 보존) —
>   data/가 gitignore+Docker 미포함이라 파일 읽기 대신 상수 커밋.
> - **LLM 레이어**: `CourseCluster.advice`(+서비스 그림자 타입 양쪽), `rules_context` 주입,
>   max_tokens 12000(잘리면 전멸), thinking off 유지. 비수업 요소는 신규
>   `suggest_support_elements`(환각 필터가 비수업을 구조적으로 걸러 별도 호출) — UI에
>   "AI 제안" 배지로 정직하게 구분.
> - **인테이크**: `/api/constellation-intake` — chat 프록시(서버가 messages 갱신 반환 —
>   mock의 assistant 카운트 무한루프 방지), bins/fill 백그라운드 job(uid 스코프 `bin_jobs.py`,
>   폴링 계약 `{bins:[...]}` 단일 형태), rate limit. 동기 Firestore는 to_thread 래핑.
> - **발행**: `PATCH /{cid}/publish` + 프론트 토글·상태 칩(새로고침 유지 확인).
> - **bins 영속화**: `Constellation.bins`(생성 동봉 + PUT 전체교체, 30/50 캡, 구 문서 역호환).
> - **프론트**: 챗 오버레이(빈 상태 자동, bootState 4경로), ⓘ 인라인 디스클로저(클리핑·
>   드래그 함정 회피), 새 별자리 리셋(objectURL revoke 포함), 900ms 데모 타이머 → 실제 fill job,
>   course 칩 code/label 분리(캔버스 이중 표기 방지), description이 노드·서버까지 전달되도록 수정.
> - **QA 도구**: `scripts/seed_emulator_courses.py`(22과목, mock 학과 맵 정합),
>   launch.json `backend-mock`(APP_ENV=test — dev .env가 실키라 mock 강제용).
> - **다음 후보**: S7 정리(splitCourseCode fallback 제거+BinItem.code — 보류됨), 실 LLM
>   스모크 테스트(키는 .env에 있음), 소셜 피드(발행물 렌더), 구 기능 Firebase 마이그레이션,
>   Storage 첨부(Blaze). 참조데이터: organizations 시드는 여전히 없음(지원 요소는 LLM 창작).
> - 함정 메모: 강제종료로 고아 프로세스(java 8080, node 3000)가 포트를 물면 preview/에뮬레이터
>   기동 실패 — netstat로 확인 후 정리. 에이전트 emulators:exec와 장기 실행 에뮬레이터는
>   포트 충돌하므로 동시 사용 금지.

> **2026-08-27 인증 배선 세션 결과 — ① 4번 "인증 배선 + 프론트 전환" 완료** (커밋
> `2ec49ef`·`3ae907c`·`ee16faf`·`92e4cf5`·`54132a1`·`750d10e`, 에뮬레이터 E2E 실검증 통과):
> - **백엔드**: `POST /api/auth/sync` — 3단 yonsei 판정(토큰 클레임 → 이메일 자동 부여 →
>   라이브 조회, 학생증 경로 stale 토큰 커버) + `users/{uid}` 프로필 upsert(`user_repo.py`,
>   created_at/consent_at 1회 기록). `mint_id_token` 공용 헬퍼화. 에뮬레이터 테스트 10개 추가
>   (Firebase 계열 총 30개 그린).
> - **프론트**: firebase 12.18.0, `lib/firebase.ts` 지연 초기화(SSR/Workers 안전),
>   `request()`가 Bearer 자동 주입(쿠키 병행 유지). auth-context 전면 재작성(onAuthStateChanged
>   + sync 병합, 라우팅은 sync 응답 기준). login/signup/verify 페이지 Firebase 재작성(PIPA 동의
>   유지→consent_at 저장, verify는 5초 폴링+재발송 쿨다운, 학생증은 준비 중 표시).
>   `lib/constellation-api.ts` 14개 함수. `constellation/new` 저장 배선: 직렬 뮤테이션 큐
>   (드롭→드래그 순서 보장), uuid id(카운터 충돌 픽스), 제목 모달 최초 저장(완료상태·시드노트
>   재생), 마운트 시 최신 별자리 복원. 첨부는 Storage 전까지 `[]` 전송.
> - **E2E 실검증**(에뮬레이터): 가입→인증메일 링크→자동 폴링으로 연세 인증 완료→별자리 저장
>   (POST 201→완료 PATCH→노트 3건 직렬)→새로고침 복원→노드 추가(모두 추가→POST 201×2)→
>   재복원까지 전부 통과. 노트 응답 camelCase·epoch-ms·ownerId=uid 확인. 미인증 REST 직접
>   접근은 rules가 403(기본 deny 작동).
> - **dev 환경**: `.claude/launch.json`에 backend(uvicorn+에뮬레이터 env)/frontend 항목 추가.
>   에뮬레이터는 `firebase emulators:start --only auth,firestore --project demo-ourlab`
>   (⚠️ --project 누락 시 ourlab-0808 네임스페이스로 떠서 데이터 안 보임). 인증 링크는
>   `GET :9099/emulator/v1/projects/demo-ourlab/oobCodes`로 조회 가능.
> - **다음 우선순위**: C(군집 advice — 학칙 추출본 근거) · D(진입 플로우) · 남은 정리:
>   splitCourseCode fallback 제거+BinItem.code(S7, 보류됨), 구 기능(일정·프로필·팔로우)
>   Firebase 마이그레이션, Storage/첨부(Blaze 후), 실서비스 웹 config(.env만 교체하면 됨).
> - ⚠️ 이 세션 중 컴퓨터 강제종료 2회 발생 — 서브에이전트 산출물은 작업 트리에 남아
>   재개 가능했음(SendMessage로 트랜스크립트 재개가 유효한 패턴).

> **2026-08-27 백엔드 세션 결과 — ① 1~3 "영속화 묶음" 완료** (커밋 `7ff7457`→`c609ac8`,
> 브랜치 `feature/constellation`, 에뮬레이터 pytest 78개 전부 통과):
> - **Step 0 (선행 버그픽스)**: 구 `constellation_repo.py`의 dot-notation 경로가 프론트 실제
>   id(`element:x`, `edge-local-1`, uuid, 숫자 시작)에서 ValueError로 죽던 BLOCKER를
>   `FieldPath(...).to_api_repr()` 이스케이프로 수정 + 회귀 테스트 5종 (`7ff7457`).
> - **Node에 `code`/`description`/`level`/`note_count` 추가** + `Note`/`NoteAttachment` 도메인
>   모델 (`be3fb7c`). 빈 title/body 허용이 모델 docstring·테스트로 고정됨.
> - **`note_repo.py` 신규** (`f1ede49`): `Note.owner_id` 비정규화로 update/get/list가 부모 문서를
>   안 읽음(자동저장 쓰기 경합 회피). create/delete만 부모 트랜잭션(note_count 증감, floor 0).
>   remove_node/delete_constellation이 notes를 ≤500 배치로 연쇄 삭제(노트 먼저→부모 마지막).
>   읽기는 updated_at을 절대 안 건드림(정렬 키 보호).
> - **HTTP API 14개** (`c609ac8`): `/api/constellations` + nodes/edges/notes 서브리소스.
>   인증은 `app.auth.deps.get_current_user`(Firebase Bearer). **와이어 포맷 = 프론트 계약**:
>   camelCase alias, epoch-ms 정수 타임스탬프, `noteCount` 0이면 생략, 클라이언트 생성 id 수용,
>   첨부 url은 https/blob만. 에러 매핑 404/403. 별자리 생성은 초기 nodes+edges 동봉 가능.
> - **다음 세션 최우선 = ④ 인증 배선 + 프론트 전환** (아래 ① 4번). 그 다음 C(advice)·D(진입
>   플로우). 프론트 `lib/api.ts` 별자리 배선과 `splitCourseCode` fallback 제거는 인증 세션에서
>   함께(배선 전 제거하면 데모 표기가 깨짐).
> - ⚠️ 배포 체크리스트: `main.py`의 `enforce_origin` 미들웨어 — 배포 프론트 origin이
>   `cors_allowed_origins`에 없으면 모든 쓰기 403. 인증 배선 세션에서 확인.
> - PIPA 메모: 노트는 개인정보 저장소가 됨 — is_public 기본 false, 삭제 연쇄(파기) 구현됨.
>   Storage 첨부 도입 시(G) 처리방침에 항목 추가 필요.
> - 환경: Firestore 에뮬레이터는 Java 필요 — Temurin JDK 21이
>   `C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot\bin`에 있음(PATH에 없음, 테스트
>   실행 시에만 prepend). `firebase emulators:exec`의 스크립트는 `.venv\Scripts\python.exe`
>   백슬래시 표기 필수(cmd.exe 경유). 구 Postgres 계열 테스트는 도커 미기동 시 ConnectionRefused
>   (21f+55e) — 코드 문제 아님.

> 이 문서는 지난 세션(프론트 캔버스/노트 + 일부 백엔드) 이후, **다음 세션이 백엔드에 집중**할 때
> 바로 로드할 컨텍스트다. 각 항목은 실제 리포 상태와 대조해 검증했다. 표시 규칙:
> ✅검증됨 / ⚠️리포와 불일치(정정함) / ❓미검증(덤프 기준, 시간 부족으로 직접 확인 못함).
>
> 대조 기준: `git log --oneline -30` (branch `feature/constellation`), 계획 문서
> `C:\Users\user\.claude\plans\polymorphic-nibbling-balloon.md`, `docs/design-handoff-guide.md`.

---

## ① 다음 세션 최우선 작업 (순서 제안)

1. **별자리 HTTP API 배선 (A)** — `constellation_repo.py`는 이미 CRUD+소유권+트랜잭션까지
   구현·에뮬레이터 테스트 완료 상태(`backend/tests/test_constellation_repo.py`,
   `test_constellation.py` 존재 확인)인데 그 위에 라우터가 없다. `backend/app/api/`에
   `constellation.py`가 없다(✅검증됨 — `constellation` 문자열로 api 디렉터리 grep 시 매치 0건).
   이게 없으면 프론트가 아무것도 저장 못 하므로 최우선.
2. **`Node` 모델에 `code`/`description`/`note_count` 추가 (A)** — 프론트
   `ConstellationCanvas.tsx`는 이미 `code?`, `description?`, `noteCount?`를 쓰고 있고, 심지어
   `code`가 없을 때를 대비한 정규식 라벨 파싱 fallback(`splitCourseCode`, 46~53행·217행 부근)까지
   임시로 넣어둔 상태다. 백엔드 `app/domain/constellation.py`의 `Node`에는 이 세 필드가 전혀
   없다(✅검증됨, 실제 파일 읽음). 필드 추가 후 프론트 fallback을 걷어내는 것까지가 한 묶음.
3. **노트 서브컬렉션 리포 신규 작성 (A)** — `constellations/{id}/notes/{noteId}` 리포가
   백엔드에 전혀 없다(✅검증됨 — `backend/app/firestore/`에 `constellation_repo.py`,
   `course_repo.py`, `client.py`뿐, note 관련 파일 0건; `backend/tests/`에도 note 테스트 없음).
   프론트 `ElementNotesPanel.tsx`는 이미 `title/body/isPublic/attachments` 형태로 노트를
   다루고 있어 스키마 방향은 이미 확정돼 있다(계획 문서 §"요소=노트 폴더" 참고).
4. **Firebase 인증 라우트 + 프론트 전환 (B)** — 순서상 1~3보다 늦어도 되지만, 로그인 자체가
   막혀 있어 QA가 불가능하다. `app/auth/`(`deps.py`, `firebase_auth.py`)는 토큰 검증 로직만
   있고 signup/login 라우트가 없다(✅검증됨). `frontend/lib/api.ts:107`이 여전히
   `/api/auth/me`(구 FastAPI)를 호출하고 `auth-context.tsx`가 그걸 그대로 쓴다(✅검증됨,
   코드 인용: `frontend/lib/api.ts:11` `NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"`,
   `:107` `return request("/api/auth/me")`). 프론트 `package.json`/`lib`에 Firebase 클라이언트
   SDK 관련 import가 전혀 없다(✅검증됨 — `firebase/app`, `firebase/auth` grep 매치 0건).
5. **군집별 AI 조언 `advice` 필드 (C)** — `backend/app/llm/base.py`의 `CourseCluster` 클래스에
   `advice` 필드가 없다(✅검증됨, 139행 `class CourseCluster`, `advice` grep 매치 0건). 덤프의
   "에이전트가 손대기 전에 중단됨" 주장과 일치 — 백엔드는 정말 미착수 상태.

이 5개를 마치면 D(진입 플로우)·E(LLM 방어)·F(비과목 데이터)로 넘어가는 게 자연스럽다(계획 문서
Phase 3→2→4 순서와도 대략 일치).

---

## ② 기능 백로그

### A. 영속화 — ✅검증됨 (위 ①에 상세 서술, 여기서는 요약만)
- `constellation_repo.py` 있음 / HTTP 레이어 없음 / notes 리포 없음 / `Node`에 3필드 없음 /
  프론트 `lib/api.ts`에 constellation 관련 엔드포인트 호출 코드 없음(✅검증됨, api.ts 전체에
  `constellation` 문자열 없음 — grep 결과 없음).

**A-보강 (2026-08-27 프론트 세션 후반 확정 — 노트 데이터 계약이 문서 최초 작성 시점보다 진화함):**
프론트(`ElementNotesPanel.tsx`/`page.tsx`)가 이미 구현·검증한 계약이므로 백엔드가 이를 따라야 한다.
- **노트 필드 확정**: `title`(빈 문자열 허용 — 표시만 "무제" 폴백) / `body`(빈 값 허용 —
  **의도적으로 노트를 비우는 것이 지원됨**, 서버 검증이 빈 본문을 거부하면 안 됨) /
  `isPublic`(기본 **false**) / `attachments: [{id, name, mimeType, url}]` / `createdAt` / `updatedAt`.
- **자동 저장**: 저장 버튼 없음. 타이핑 0.8초 디바운스 + 블러/Esc/접기/노트전환/언마운트마다 커밋.
  프론트가 `lastCommittedRef` 스냅샷 비교로 **무변경 no-op을 이미 거르지만**, 백엔드도 쓰기 빈도를
  전제로 설계할 것(노트 하나에 분당 수회 PATCH 가능).
- **`updatedAt`은 목록 정렬 기준** — 열람만으로 갱신되면 안 된다(프론트에서 이 버그를 잡은 이력
  있음. 서버가 매 요청 타임스탬프를 찍으면 재발한다).
- **노드 삭제 → 그 노드의 노트·첨부 연쇄 삭제**: 프론트는 로컬에서 이미 수행(객체 URL revoke 포함).
  Firestore 재귀 삭제에 notes 서브컬렉션 + Storage 오브젝트를 반드시 포함할 것.
- **첨부는 Storage URL로 교체되는 구조**: 현재 blob URL이 들어가는 자리에 Storage URL이 그대로
  들어가도록 필드를 잡아뒀다. 10MB/이미지 제한은 프론트가 이미 강제 — 서버도 이중으로 강제할 것.

### B. 인증 배선 — ✅검증됨
덤프 그대로 확정. Firebase Auth email/password 콘솔 설정·Firestore 리전(asia-northeast3)은
리포로는 직접 확인 불가(❓콘솔 상태, 덤프 기준으로 신뢰).

### C. 군집별 AI 조언 (i 버튼) — ✅검증됨(미착수 확인)
- `CourseCluster`(`app/llm/base.py:139`), `CourseClusterResult`(147행) 확인. `advice` 필드,
  프롬프트, mock 지원, `services/course_clustering.py` 패스스루 전부 없음.
- ⚠️ **thinking 모드 금지 규칙은 사용자 룰이 아니라 코드베이스에 실제로 새겨져 있다** —
  `anthropic_client.py` 636~641행 주석: "후보가 많을 수 있는 판단이라 출력 예산을 넉넉히
  잡는다. thinking은 끈다 — 이 코드베이스에서 세 번 반복된 함정(작은 max_tokens + thinking =
  JSON 잘림)." 즉 이미 3번 재발한 실측 버그이고, `advice` 프롬프트를 추가할 때도
  `thinking={"type": "disabled"}` 패턴을 그대로 따라야 한다(281·311·591·636행 등 기존
  경량 호출 4곳 모두 이 패턴).

### D. 진입 플로우(망원경) 백엔드 — ✅검증됨(참조 파일 실재)
`app/services/roadmap_gen.py`, `app/services/preview_jobs.py`, `app/api/roadmap.py` 모두
존재(구 시스템 그대로 남아있음, 참조용). `app/services/course_clustering.py`도 존재. 계획
문서 Phase 4 설명과 일치. 추천 별자리(AI 제안 전체 그래프)는 신규 기능 — 리포에 착수 흔적 없음.

### E. LLM 방어 격차 — ✅검증됨
- `select_relevant_departments`(`anthropic_client.py:576`)는 LLM이 반환한 학과/단과대 이름을
  그대로 쓰고 Firestore의 실제 값과 대조하는 검증 코드가 없음(576~591행 확인, 이후 로직에도
  검증 없음).
- `suggest_course_bin`(`course_clustering.py:141`)은 실제로 `list_by_department`와
  `search_by_college`를 이름마다 둘 다 호출한다(158~161행, 주석: "LLM이 반환하는 이름이
  학과명인지 단과대명인지 보장되지 않으므로 두 필드 모두로 조회해본다" — 덤프의 "이중 조회"
  지적이 정확).
- 테스트 커버리지: `backend/tests/test_course_clustering.py`에 `select_relevant_departments`·
  `cluster_courses` 테스트는 있지만(32~107행 확인), `suggest_course_bin` 자체를 호출하는
  테스트는 0건(✅ 덤프의 "zero test coverage" 확인).

### F. 비과목 요소 데이터 — ✅검증됨(부분)
`firestore.rules`에 `organizations/{orgId}` 규칙이 실제로 존재(95~97행, "reference-data
pattern" 주석). 이를 채우는 ETL 스크립트는 리포에서 발견 안 됨(❓ "아무것도 안 씀"은 시간상
전수 확인은 못 했으나 관련 스크립트 부재로 개연성 높음). 학생증 리뷰 어드민 도구·Cloud
Storage 연동은 미착수 — 리포에 해당 코드 없음(✅검증됨, 관련 API/모델 없음).

### G. 저장소/결제 — ❓미검증(덤프 기준)
가격(Blaze 종량제 수치, ₩150/월 추정)은 Google 콘솔 상태라 리포로 확인 불가. 단 프론트
`ElementNotesPanel.tsx`의 첨부파일 형태는 확인됨: `NoteAttachment`가 `mimeType`, `attachments:
NoteAttachment[]` 필드를 가짐(29~48행) — 덤프가 말한 "blob URL을 스토리지 URL로 교체" 방향과
정합. DOCX 미리보기 라이브러리 결정 여부는 ❓미검증.

### H. follows 필드 보완 — ✅검증됨(리포가 스스로 문제를 문서화하고 있음)
`firestore.rules` 55~78행을 직접 읽었다. 놀랍게도 규칙 파일 자체가 이 갭을 이미 주석으로
남겨뒀다: "no follower_id/followee_id field exists yet in the domain model (see report: this
is a gap if the app later needs to query 'who do I follow' ...)". 즉 덤프 내용이 정확할 뿐
아니라, **다음 세션이 이 규칙 파일의 주석을 그대로 작업 티켓처럼 참고할 수 있다.** 필드 검증도
아직 없음(현재는 `followId.matches(uid + '_.*')`로 id 접두사만 검사, 69~78행).

### I. 데이터 품질 — ❓미검증(덤프 기준)
Firestore 실 데이터 카운트(7,109건 등)는 라이브 조회가 필요해 시간상 확인 못 함. 단
`app/firestore/course_repo.py`에 `list_by_department`/`search_by_college`(74·84행) 등 덤프가
언급한 조회 함수들의 실재는 확인됨.

### J. 구 백엔드 정리 — ✅검증됨
`backend/app/api/`에 `roadmap.py`, `beans.py`, `goals.py`, `auth.py`, `todos.py`, `users.py`,
`ncs.py`, `health.py` 전부 존재(디렉터리 리스트로 확인). `backend/app/email/`도
`base.py`/`mock_sender.py`/`resend_sender.py` 그대로 남아있음(✅검증됨 — 삭제 미실행).
`backend/tests/test_email_sender.py` 존재(✅검증됨). `backend/wrangler.jsonc`,
`backend/alembic/` 등도 확인은 못 했으나(❓ 디렉터리 존재 자체는 안 봤음, 시간 부족) 인접
증거(package.json/wrangler에 이름이 여전히 `ourcompass-backend`로 남은 것, 아래 K 참고)로
미실행 개연성 높음.

### K. 문서 개정 — ✅검증됨 + ⚠️정정 1건
- CLAUDE.md가 구 스택(FastAPI/Postgres/Alembic/pgvector, `fastapi dev`, 구 디렉터리 레이아웃)을
  "locked-in"으로 선언 중인 것은 이 대화 시스템 프롬프트에 실제로 포함된 CLAUDE.md 원문으로
  재확인됨 — 개정 필요 확정.
- ⚠️**정정**: 덤프는 "Model Selection Guide 충돌"만 언급했는데, 사용자 메모리(`MEMORY.md`)를 보면
  실제로는 **계획=Fable, 세부검증=Opus, 구현=Sonnet**로 이미 갱신됐고 "CLAUDE.md의 Model
  Selection Guide와 충돌하니 리포 문서도 갱신 필요"라고 명시돼 있다. 즉 이건 이번 세션이 아니라
  더 이전(2026-08-26) 결정이고, 아직도 CLAUDE.md에는 반영 안 됨 — 개정 대상 목록에 그대로 유효.
- ⚠️**신규 발견(덤프에 없던 내용)**: 브랜드 리네임이 백엔드 인프라에도 이미 절반 남아있다.
  `backend/package.json`의 `"name"`이 `"ourcompass-backend-container-router"`, `backend/wrangler.jsonc`의
  `"name"`이 `"ourcompass-backend"`이고 `class_name: "OurCompassBackend"` /
  `binding name: "OURCOMPASS_BACKEND"`까지 남아있음(직접 grep 확인). 덤프도 "백엔드/인프라는
  post-migration sweep으로 이연"이라 했으니 방향은 맞지만, 이 세션에서 실제 파일·값까지 확인해둔다.

### L. 환경 실전 노트 — 일부 ✅검증됨, 일부 ❓미검증
- ✅**검증됨**: `firebase-admin` 7.5.0의 emulator workaround 실재 확인 —
  `backend/app/firestore/client.py`에 `_EmulatorCredential(credentials.Base)` 클래스가 실제로
  있고, "google-cloud-firestore의 Client는 FIRESTORE_EMULATOR_HOST가 설정돼 있고 ... 아래
  _EmulatorCredential로 명시적으로 우회한다"는 주석까지 일치.
- ⚠️**정정**: 덤프는 "pdfplumber installed"라고만 적었는데, 실제로는 **설치는 돼 있지만
  `backend/pyproject.toml`의 `dependencies`에 선언돼 있지 않다**(pyproject 전체를 읽었고
  `pdf`/`pdfplumber` 문자열이 dependencies 목록에 없음; 대신 `.venv/Lib/site-packages/pdfplumber`
  실물 확인). **다음 세션이 새 venv나 CI에서 그대로 재현하면 깨진다** — 커리큘럼 파서를 다시
  만지기 전에 `pyproject.toml`에 `pdfplumber`를 추가해둘 것.
- ❓미검증(머신 상태라 리포로 확인 불가, 이전 세션 실측치이므로 신뢰): Firebase CLI 경로, JDK
  경로, 에뮬레이터 명령 패턴, `--project demo-ourlab` 관례, pytest 62/2 베이스라인 수치.
- ✅검증됨: `test_constellation.py`/`test_constellation_repo.py`, `test_course_clustering.py`,
  `test_email_sender.py` 전부 리포에 실재(파일 존재만 확인, 실행은 안 함 — 시간 제약).

---

## ③ 삭제·정리 대상

- `backend/app/email/`(`base.py`, `mock_sender.py`, `resend_sender.py`) + `EmailVerification`
  모델/설정 키(`RESEND_API_KEY` 등) + `tests/test_email_sender.py` — Firebase 내장 이메일로
  대체 확정, 아직 미실행(✅검증됨, 파일들 그대로 존재).
- 구 FastAPI 콩나무 계열: `api/beans.py`, `api/goals.py`, `models/roadmap.py`의 Milestone/
  BeanTransaction/PostLike 관련 클래스, `services/roadmap_gen.py`(별자리용으로 재작성 예정이라
  완전 삭제는 아니고 교체), `payments/`(존재 확인은 못 함, ❓).
- 인프라: `backend/alembic/`, `backend/docker-compose.yml`, `backend/wrangler.jsonc`,
  `backend/src/index.ts` — 계획 문서 Phase 8 대상. wrangler.jsonc는 이번에 이름까지 확인함
  (K 참고), 삭제 시점까지는 리네임도 미룬다는 계획과 일치하므로 지금 손대지 말 것.
- 주간 콩 랭킹: 계획 문서·덤프 모두 "완전 폐기, 재건 금지"로 일치 — `app/ranking/page.tsx`
  등 프론트 잔재도 함께 확인 필요(이번엔 시간상 프론트 쪽 재확인 생략, ❓).

---

## ④ 사용자 콘솔 작업 (사람이 해야 하는 것)

- Firestore/Firebase Auth 콘솔 설정 상태(project `ourlab-0808`, asia-northeast3, STANDARD/Native)는
  ❓미검증(콘솔이라 리포로 확인 불가, 덤프 신뢰).
- Cloud Storage용 **Blaze 요금제 업그레이드 결정 대기 중** — 업그레이드 시 예산 알림(월 한도
  50/90/100%) 먼저 설정. 계획 문서 Phase 7에도 동일하게 명시돼 있어(177~180행) 이 부분은
  ✅검증됨(계획 문서 원문과 일치).
- 학회/동아리 공식 공개 목록 정리 — 계획 문서에 "사용자가 정리해 제공"이라 명시(143행),
  아직 제공 안 된 것으로 보임(리포에 데이터 없음).
- 수강편람 파일(연세대 과목 위계) 제공 — 계획 문서 §열린 질문 1(238~239행)에 "포맷 미정,
  사용자가 제공하는 시점에 확인"이라고 명시. 아직 미제공으로 보임(파서 코드 없음, ❓).

---

## ⑤ 환경 실전 노트 (명령어·함정)

- Windows cp949 콘솔은 한글 출력 시 깨짐 — UTF-8로 파일 작성 권장(이 문서 자체가 그 사례).
- `firebase-admin` emulator workaround: `app/firestore/client.py`의 `_EmulatorCredential`
  없이는 Admin SDK가 `FIRESTORE_EMULATOR_HOST`를 자동 인식하지 않음(Auth 에뮬레이터는 자동
  인식, 대조적). ✅검증됨(코드 확인).
- ⚠️**정정**: pdfplumber는 venv엔 있지만 `pyproject.toml`에 미선언 — 커리큘럼 파서 작업
  재개 전에 `pyproject.toml` dependencies에 추가할 것(위 L 참고).
- `firestore.rules`의 `course_catalog/{deptCode}` 와일드카드 이름이 실제로는 과목코드에
  매치되는 flat 레이아웃이라는 지적은 ✅검증됨(81~85행 주석 자체가 "Same read-mostly
  reference-data pattern as course_catalog"이라며 organizations를 course_catalog와 동일
  패턴으로 설명 — 구조 자체는 확인, "이름이 오해의 소지가 있다"는 지적까지는 규칙 파일
  주석에서 명시적으로 재확인은 못 함, ❓세부).
- 나머지(Firebase CLI 경로, JDK 경로, `--project demo-ourlab`, pytest 62/2 베이스라인)는
  머신 상태·실행 결과라 리포 정적 분석으로는 재확인 불가 — ❓미검증(덤프 기준), 다음 세션
  시작 시 `pytest -v`로 베이스라인 재확인 권장.

---

## ⑥ 미결정 사항

1. **수강편람 파일 포맷** — PDF vs Excel/CSV, 계획 문서 §열린 질문 1(그대로 유효).
2. **자격증/네트워킹 bin의 데이터 근거** — 큐넷 등 공개 데이터 연동 여부, 계획 문서 §열린
   질문 2(그대로 유효). 크롤링(특히 에브리타임)은 계획 문서에 **법적 판단으로 명시적 배제**됨
   (253~267행, 부정경쟁방지법·정보통신망법 리스크) — 이 결정은 번복하지 말 것.
3. **NCS 데이터 존속 여부** — 계획 문서 §열린 질문 3, 낮은 우선순위지만 Phase 4(군집화) 설계
   전에는 확정 필요.
4. **Firestore 문서 1MiB 한도 대응** — 계획 문서 §열린 질문 4, 초기 규모에서는 낮은 리스크로
   보류 중.
5. **DOCX 미리보기 라이브러리** — G 항목, 결정 안 됨(❓미검증, 콘솔/논의 상태라 리포 확인 불가).
6. **CLAUDE.md 개정 실행 시점** — 개정 필요성은 확정됐으나 실제 반영은 아직 안 함(이 문서
   작성 시점 기준). 다음 세션에서 A~E 작업과 함께 처리할지, 별도 세션으로 뺄지 미정.
7. **붙임 1 PDF(학칙·규정류) — ✅확인 완료, 핵심부 추출됨 (2026-08-27)** — 사용자 지시("니가
   확인해보고 쓸만한 정보 있으면 건져내")로 분석 완료. 실제 474쪽(메타데이터는 37쪽으로 오보고,
   붙임 2 때와 동일 현상). 앞부분(연혁·캠퍼스)은 무용, **p117~166 「학사안내」부가 핵심**:
   소속변경(=전과, 3학기~3학년 + **지원 전 소속학과 전공 9학점 선이수**), 복수전공/부전공/연계전공
   (자격·정원 10%·중복인정 규칙·지원불가 학과), 조기졸업(3.75↑), 재수강 제한(학번별), 학사경고
   3회 제적, 계절학기 한도, 졸업요건 — **군집별 AI 조언(C 항목)의 규정 근거 데이터로 그대로 사용
   가능**. 해당 구간을 `data/yonsei-academic-rules-2026.txt`(UTF-8, 2,040줄)로 추출해 둠
   (data/는 gitignore 대상 — 원본 PDF가 Downloads에 있는 한 재생성 가능. C 항목 구현 시 이
   텍스트를 조언 프롬프트의 근거 자료로 주입하거나 Firestore 참조 컬렉션으로 적재할 것).
   p166 이후의 학칙·내규 원문 전문은 필요 시 같은 방법으로 추가 추출.

---

## 검증 방법 요약 (재현용)

`git log --oneline -30` / `ls backend/app/api backend/app/llm backend/app/firestore
backend/app/auth backend/app/email backend/app/services` / `grep -n "advice" backend/app/llm/
base.py` / `grep -rn "NEXT_PUBLIC_API_BASE_URL|getMe|/api/auth/me" frontend/lib/api.ts frontend/
lib/auth-context.tsx` / `app/domain/constellation.py` 직접 읽음 / `frontend/components/
ConstellationCanvas.tsx`에서 `code|description|noteCount` grep / `firestore.rules` 55~120행
직접 읽음 / `backend/pyproject.toml` 전체 읽음 / `backend/package.json`, `backend/wrangler.jsonc`
name 필드 grep / `backend/tests/` 디렉터리에서 관련 테스트 파일 존재 확인(실행은 안 함).

시간 제약(~10분)으로 **실행**(pytest, 에뮬레이터, Firestore 라이브 조회)은 하지 않았고 전부
**정적 파일 대조**로만 검증했다 — I(데이터 품질 수치), G(요금제 수치), L의 머신 상태 항목은
다음 세션 시작 시 직접 재확인 권장.
