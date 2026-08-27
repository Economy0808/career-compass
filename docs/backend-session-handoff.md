# 백엔드 세션 핸드오프 (2026-08-27 작성)

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
