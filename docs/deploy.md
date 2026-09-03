# 배포 절차 (Cloud Run x2)

> **상태: 2026-08-31 배포 완료.** 이 문서는 원래 계획본으로 작성됐다가, 실제
> 배포 결과에 맞춰 갱신됐다. 아래 구성이 **현재 라이브에서 돌고 있는 것**이다.
>
> - 프론트: https://ourlab-frontend-902034641778.asia-northeast3.run.app
> - 백엔드: https://ourlab-backend-902034641778.asia-northeast3.run.app
> - 체험 계정: `test-observer@yonsei.ac.kr` / `observatory123!` (연세대 인증 완료)
>   미인증 상태 확인용은 `demo-unverified@example.com` (같은 비밀번호)

## 목표 구성

- 프론트(Next.js 14, `frontend/`) → **Cloud Run** (컨테이너)
- 백엔드(FastAPI, `backend/`) → **Cloud Run**
- Firestore·Auth → 기존 Firebase 프로젝트 `ourlab-0808` 그대로 사용
- 비밀키는 전부 Secret Manager. 코드·설정 파일에 실제 값 없음.

> **⚠️App Hosting은 쓰지 않기로 했다.** 처음엔 프론트를 Firebase App Hosting에
> 올릴 계획이었으나, `apphosting:backends:create`가 **GitHub 저장소 연결을
> 요구**한다. 이 리포는 GitHub에 연결돼 있지 않아 그 자리에서 막혔고, 프론트를
> 컨테이너로 만들어 Cloud Run에 올리는 쪽으로 바꿨다(`frontend/Dockerfile`,
> `next.config.mjs`의 `output: "standalone"`). `firebase.json`의 `/api/**`
> rewrite와 `frontend/apphosting.yaml`은 그 시절 잔재라 **현재 배포 경로에서
> 쓰이지 않는다** — 프론트는 `NEXT_PUBLIC_API_BASE_URL`로 백엔드를 크로스오리진
> 직접 호출한다.

## 0. 사전 확인

- [ ] `gcloud auth login` / `gcloud config set project ourlab-0808`
- [ ] `firebase login` / 프로젝트가 Blaze 요금제인지 콘솔에서 확인 (사용자가 이미 전환 완료라고 함)
- [ ] Cloud Run, Secret Manager, Cloud Build API가 `ourlab-0808`에서 켜져 있는지
      확인 (`gcloud services enable run.googleapis.com secretmanager.googleapis.com cloudbuild.googleapis.com`)

## 1. 필요한 환경변수 / 시크릿 전체 목록

값은 절대 이 문서나 커밋에 적지 않는다. 이름만 정리.

### 백엔드 (Cloud Run) — Secret Manager로 넣을 것

| 이름 | 용도 | 비고 |
|---|---|---|
| `SECRET_KEY` | 세션 서명 키 | 운영에서 `change-me` 기본값 그대로 두면 안 됨 |
| `ANTHROPIC_API_KEY` | Claude API | 없으면 Mock LLM으로 자동 폴백 (앱은 안 죽음) |
| `ANTHROPIC_WORKSPACE_ID` | 개인 계정 연동형 키를 쓸 때만 필요 | 워크스페이스 스코프 키면 비워도 됨 |
| `RESEND_API_KEY` | 이메일 발송 | 없으면 실발송 비활성 (플레이스홀더 판정 로직 있음) |
| `DATA_GO_KR_API_KEY` | NCS 공공데이터 API | |
| `OPENAI_API_KEY` | `.env`에는 있으나 **현재 `app/config.py`의 `Settings`에 필드가 없어 코드에서 안 읽힘** — 확인 필요 (아래 "발견한 걸림돌" 참고). 당장 배포에는 불필요할 수 있음 |
| `SOLAPI_API_KEY` / `SOLAPI_API_SECRET` | 카카오톡 알림(Solapi) | 위와 동일하게 현재 코드에서 참조하는 곳을 못 찾음 — 미사용 추정, 확인 필요 |

Secret Manager에 등록:

```bash
printf '%s' "<실제 값>" | gcloud secrets create secret-key --data-file=-
printf '%s' "<실제 값>" | gcloud secrets create anthropic-api-key --data-file=-
printf '%s' "<실제 값>" | gcloud secrets create resend-api-key --data-file=-
printf '%s' "<실제 값>" | gcloud secrets create data-go-kr-api-key --data-file=-
# 필요하면 anthropic-workspace-id, openai-api-key, solapi-api-key, solapi-api-secret도 동일하게
```

이미 시크릿이 있으면 `create` 대신 `versions add`:

```bash
printf '%s' "<새 값>" | gcloud secrets versions add secret-key --data-file=-
```

### 백엔드 (Cloud Run) — 일반 환경변수 (Secret Manager 아님, 값 자체가 민감하지 않음)

| 이름 | 값 | 비고 |
|---|---|---|
| `APP_ENV` | `production` | `cookie_secure` 등 분기에 씀 |
| `CORS_ALLOWED_ORIGINS` | App Hosting 배포 도메인 (콤마로 여러 개 가능) | 아래 "3. Origin 화이트리스트" 참고 — **배포 순서상 나중에 채워야 함** |
| `FIRESTORE_PROJECT_ID` | `ourlab-0808` | 안 넣으면 `app/firestore/client.py`가 데모 프로젝트(`demo-ourlab`)로 기본 폴백함 — 운영에서 반드시 명시 |
| `DATABASE_URL` | (설정 안 해도 됨) | Cloud SQL을 안 붙일 예정이므로 미설정 → 기본값(`localhost:5432`)으로 남음. Postgres 의존 라우트만 요청 시점에 실패 (아래 "2. Postgres 없이 기동" 참고) |

### 프론트 (App Hosting) — `frontend/apphosting.yaml`에 이미 채워둠

전부 `NEXT_PUBLIC_*`라 빌드 시 클라이언트 번들에 그대로 박히는 값들 —
공개돼도 되는 값이라 Secret Manager 불필요. `REPLACE_ME_...`로 표시된 항목만
실제 값으로 채우면 됨 (Firebase 콘솔 > 프로젝트 설정 > 일반 > 웹 앱에서 확인):

- `NEXT_PUBLIC_API_BASE_URL` (빈 문자열로 이미 채워둠 — 아래 "4. API base URL" 참고)
- `NEXT_PUBLIC_FIREBASE_API_KEY` ← REPLACE_ME
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` (이미 `ourlab-0808.firebaseapp.com`로 채워둠)
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID` (이미 `ourlab-0808`로 채워둠)
- `NEXT_PUBLIC_FIREBASE_APP_ID` ← REPLACE_ME
- `NEXT_PUBLIC_AUTH_EMULATOR_HOST`는 **의도적으로 안 넣음** — 운영에서 설정되면
  브라우저가 로컬 에뮬레이터로 붙으려다 실패한다.

## 2. Postgres 없이 기동 가능한가 — 검증 결과

**결론: 기동은 된다.** `app/db.py`의 `_get_engine()`은 첫 호출 시점에만 엔진을
만드는 지연 초기화이고, `app/main.py`의 `lifespan`은 DB를 건드리지 않는다.

검증 방법: `DATABASE_URL`을 존재하지 않는 호스트로 설정하고 `uvicorn`을 별도
포트(8099)에서 띄운 뒤 `/health`를 호출 — **200 OK** 응답 확인 (`db` 필드만
`"error"`로 표시, 앱 자체는 안 죽음).

단, **요청 시점에** Postgres를 실제로 쓰는 라우트는 개별적으로 500/503을 낸다.
현재 `app.db`(SQLAlchemy)를 import하는 곳:

- `app/core/deps.py` — 세션 쿠키 기반 로그인 의존성(`get_current_user` 등). **레거시 경로**
- `app/api/auth.py`, `app/api/users.py`, `app/api/health.py`(DB 상태 필드만)
- `app/models/account.py`, `app/models/roadmap.py`, `app/models/ncs.py`

나머지 라우터(`community`, `constellation`, `courses`, `dm`, `explore`,
`notifications`, `posts`, `profiles`, `stories`, `auth_sync`)는 `app/auth/deps.py`
(Firebase ID 토큰 기반)를 쓰고 있어 Postgres와 무관하게 동작한다 — 메모리에
남아있는 "프로필·팔로우 Firestore 이관 완료" 기록과 일치.

`todos` 관련 파일(`app/api/todos.py`, `app/models/todo.py`)은 **이 문서를 쓰는
동안 다른 세션이 Firestore로 이관 중이라 일시적으로 존재하지 않는 상태였다**
(진행 중인 작업). 이관이 끝나면 `app/main.py`의 `todos_router` import가
성공하는지, `todos` 라우트가 Postgres 없이도 동작하는지 별도로 재확인이
필요하다 — 이 배포 준비 세션에서는 그 파일들을 건드리지 않았다.

**정리**: 지금 상태로 배포해도 앱은 뜬다. 로그인(세션 쿠키 방식)·회원가입·
`/api/users/*`만 Postgres가 없어서 실패한다. Firebase Auth 기반 라우트(대부분의
기능)는 영향 없다. Cloud SQL을 나중에 붙일지, 레거시 세션 인증을 마저
Firestore/Firebase Auth로 옮길지는 이 작업 범위 밖 — 판단 필요 항목으로 보고.

## 3. Origin 화이트리스트 (`enforce_origin` / CORS)

`app/main.py`의 `enforce_origin` 미들웨어는 POST/PUT/PATCH/DELETE 요청의
`Origin` 헤더를 `cors_allowed_origins`(콤마 구분 문자열, 환경변수
`CORS_ALLOWED_ORIGINS`)와 대조한다. **배포된 프론트 도메인이 여기 없으면
로그인 이후의 모든 쓰기 요청이 403으로 막힌다.**

절차:

1. App Hosting을 먼저 배포해서 실제 도메인을 확인한다 (`*.web.app` 또는
   커스텀 도메인 — App Hosting 콘솔에 표시됨).
2. Cloud Run 서비스의 `CORS_ALLOWED_ORIGINS` 환경변수를 그 도메인으로 갱신하고
   재배포한다:
   ```bash
   gcloud run services update ourlab-backend \
     --region asia-northeast3 \
     --update-env-vars CORS_ALLOWED_ORIGINS=https://<app-hosting-domain>
   ```
   로컬 개발 origin도 같이 허용하려면 콤마로 이어붙인다:
   `CORS_ALLOWED_ORIGINS=https://<app-hosting-domain>,http://localhost:3000`

또한 `CORSMiddleware`의 `expose_headers=["X-Auth-Requirement"]`는
`app/main.py`에 코드로 박혀 있어 환경변수와 무관하게 항상 적용된다 (커밋
`de518aa` 참고) — 이 배포 절차에서 별도로 건드릴 필요 없음. 배포 후 브라우저
devtools에서 403 응답에 이 헤더가 실제로 노출되는지(`fetch` 응답의
`headers.get("X-Auth-Requirement")`) 한 번은 확인할 것 — CORS 설정은
운영 도메인에서만 발생하는 종류의 버그(커밋 메시지 참고)라 로컬 테스트로는
안 잡힌다.

## 4. 프론트의 API base URL

`frontend/lib/api.ts`:

```ts
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
```

모든 호출 경로가 이미 `/api/...`로 시작한다 (`request("/api/auth/signup", ...)` 등).
그래서 `apphosting.yaml`에는 `NEXT_PUBLIC_API_BASE_URL=""`(빈 문자열)로
채워뒀다 — 이러면 프론트는 `${현재도메인}/api/...`로 요청하고, `firebase.json`의
Hosting rewrite(`/api/** → Cloud Run 서비스 ourlab-backend`)가 같은 도메인에서
백엔드로 넘겨주는 구조를 의도한 것이다.

**⚠️ 미검증 지점**: Firebase App Hosting 백엔드가 서빙하는 사이트에 `firebase.json`의
클래식 `hosting.rewrites`가 실제로 적용되는지 공식 문서에서 명확히 확인하지
못했다 (App Hosting은 자체 사이트/롤아웃 경로를 쓰고, 클래식 Hosting 설정과는
별개로 동작한다는 정황만 있음). `firebase deploy` 후 반드시 실제로
`https://<app-hosting-domain>/api/health`를 호출해서 Cloud Run 응답이 오는지
확인할 것.

- **되면**: 그대로 유지.
- **안 되면**: `apphosting.yaml`의 `NEXT_PUBLIC_API_BASE_URL`을 Cloud Run
  서비스의 공개 URL(`https://ourlab-backend-xxxxx.a.run.app`)로 바꾸고 재배포.
  이 경우 브라우저가 크로스 오리진으로 직접 Cloud Run을 호출하게 되므로
  `CORS_ALLOWED_ORIGINS`(3번 항목)는 그대로 App Hosting 도메인을 가리키면
  된다 — 그 값은 브라우저의 `Origin` 헤더(요청을 보낸 페이지의 출처)와
  비교하는 것이지 API 서버 자신의 주소가 아니므로 바뀌지 않는다.

## 5. Cloud Run 배포 (백엔드)

```bash
cd backend

gcloud run deploy ourlab-backend \
  --source . \
  --project ourlab-0808 \
  --region asia-northeast3 \
  --allow-unauthenticated
```

> **환경변수/시크릿 플래그를 붙이지 말 것 (2026-09-03 실측).** 서비스에 이미
> `APP_ENV`, `FIRESTORE_PROJECT_ID`, `CORS_ALLOWED_ORIGINS`, `KEY_ROTATED(_AT)`
> 일반 env와 `ANTHROPIC_API_KEY`(Secret Manager, 동명 시크릿) 참조가 걸려 있고,
> 플래그 없이 배포하면 전부 그대로 승계된다. 예전 문서의
> `--set-secrets SECRET_KEY=secret-key:...` 4종 명령은 **존재하지 않는 시크릿**을
> 참조해 리비전 생성이 통째로 실패하며(기본 컴퓨트 SA 권한 거부로 표시되지만
> 실체는 시크릿 부재), 성공했다 해도 `CORS_ALLOWED_ORIGINS`를 날려버린다.
> env를 바꿀 때는 `--update-env-vars KEY=value`(기존 값 보존·해당 키만 갱신)를 쓴다.
>
> **함정: 실패한 배포도 서비스 템플릿을 오염시킨다.** 잘못된 플래그로 배포가
> 실패하면 리비전은 안 생겨도 spec.template에는 그 플래그가 남아, 이후의
> 무플래그 배포가 오염을 그대로 승계해 같은 오류로 또 실패한다. 이때는 아래
> 전체 복원 플래그로 한 번 배포해 템플릿을 되돌린다(2026-09-03 라이브
> 리비전 실측값):
>
> ```bash
> gcloud run deploy ourlab-backend --source . --project ourlab-0808 \
>   --region asia-northeast3 --allow-unauthenticated \
>   --set-env-vars "APP_ENV=production,FIRESTORE_PROJECT_ID=ourlab-0808,CORS_ALLOWED_ORIGINS=https://ourlab-frontend-902034641778.asia-northeast3.run.app,KEY_ROTATED=1,KEY_ROTATED_AT=2026-08-31" \
>   --set-secrets "ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest"
> ```

- `--source .`는 `backend/Dockerfile`을 그대로 써서 Cloud Build가 이미지를
  빌드한다 (수정 완료 — `$PORT` 지원, 아래 "수정 사항" 참고).
- Cloud Run 서비스 계정에 Firestore 접근 권한이 필요하다 — 기본 컴퓨트
  서비스 계정이면 대개 `roles/datastore.user`가 이미 있지만, 없으면:
  ```bash
  gcloud projects add-iam-policy-binding ourlab-0808 \
    --member="serviceAccount:<cloud-run-service-account>" \
    --role="roles/datastore.user"
  ```
- `--allow-unauthenticated`가 맞는지 재확인 — FastAPI 자체 인증(Firebase ID
  토큰 검증)이 있으니 맞다고 판단했으나, 최종 결정은 사용자 몫으로 남긴다.
- 배포 후 나온 URL을 기록해둔다 (4번 항목의 폴백, 5-1의 rewrite 설정 확인용).

배포가 끝나면 `/health`로 확인:

```bash
curl https://<cloud-run-url>/health
```

## 6. Cloud Run 배포 (프론트)

```bash
gcloud run deploy ourlab-frontend --source frontend --project ourlab-0808   --region asia-northeast3 --allow-unauthenticated --port 8080 --memory 1Gi   --min-instances 0 --max-instances 3   --service-account ourlab-frontend-runtime@ourlab-0808.iam.gserviceaccount.com
```

SA는 최초 1회 이렇게 만든다(역할 바인딩을 **아무것도 걸지 않는 것**이 핵심):

```bash
gcloud iam service-accounts create ourlab-frontend-runtime   --display-name "OurLab frontend runtime (least privilege, no roles)"   --project ourlab-0808
```

역할 0개 검증(감사 재게이트용 — 아무 역할도 출력되지 않아야 정상):

```bash
gcloud projects get-iam-policy ourlab-0808 --flatten="bindings[].members"   --filter="bindings.members:ourlab-frontend-runtime" --format="value(bindings.role)"
```

> `--service-account`는 2026-09-02 보안감사 DEP-1 완화로 추가됐다. 프론트는 GCP
> API를 호출하지 않으므로 **역할 0개짜리 전용 SA**를 쓴다 - 기본 compute SA
> (프로젝트 Editor)로 두면 next 14.x WebSocket SSRF로 메타데이터 토큰이 샐 때
> 프로젝트 전체가 노출된다. 플래그를 빼먹으면 리비전이 기본 SA로 돌아가니
> **재배포 시 반드시 포함할 것.**

- **⚠️`NEXT_PUBLIC_*`는 빌드 시점에 클라이언트 번들로 구워진다.** 런타임 환경변수가
  아니므로 `--set-env-vars`로는 바뀌지 않는다. 값은 `frontend/Dockerfile`의 `ARG`
  기본값에 들어 있고(전부 공개 값이라 시크릿 아님), **바꾸려면 재빌드**해야 한다.
  프론트 코드가 커밋만 돼서는 라이브가 변하지 않는다 — 랜드할 때마다 재배포 필요.
- **⚠️`next.config.mjs`의 `output: "standalone"`을 지우지 말 것.** 지우면 런타임
  스테이지가 복사할 `.next/standalone`이 생기지 않아 빌드가 깨진다.
- 빌드 스테이지는 dev 의존성까지 설치한다(`npm ci`, `--omit=dev` 아님). `next.config.mjs`가
  devDependency인 `@opennextjs/cloudflare`를 모듈 최상단에서 import하기 때문이다.
- `gcloud builds submit --substitutions`로 빌드 인자를 넘기려 하지 말 것 — 그 플래그는
  cloudbuild 템플릿 치환용이라 Docker `ARG`와 무관하다(실제로 이 함정에 한 번 빠졌다).

## 7. 배포 후 확인 — 실제 수행 결과

전부 라이브에서 실측 완료했다. 재배포 후 회귀 확인용으로 그대로 재현하면 된다.

| 확인 | 결과 |
|---|---|
| 프론트 `/`, `/demo`, `/constellation/new` | 200 |
| 백엔드 `/health` | `{"status":"ok","db":"error"}` — `db:error`는 **의도된 상태**(Postgres 미연결) |
| 비로그인 쓰기 | 401 |
| 미인증 계정 쓰기 | 403 + `X-Auth-Requirement: yonsei-verified` |
| 인증 계정 API 11경로 | 전부 200 (커뮤니티·DM·알림·피드·탐색·별자리·수업검색·분류·프로필) |
| 실제 Claude 호출 | 인테이크 챗 200 / 성운 제안 잡 10개 생성, advice 포함 |
| 실브라우저 로그인 | 로그인 → 접안렌즈 → 캔버스 → 커뮤니티까지 완주 |

**⚠️판정은 브라우저 콘솔이 아니라 서버 로그로 하라.** 프론트 수정 배포 후 콘솔에
옛 401이 그대로 남아 있어 "안 고쳐졌다"고 오판할 뻔했다. 권위 있는 확인:

```bash
gcloud logging read 'resource.type="cloud_run_revision"
  AND resource.labels.service_name="ourlab-backend"
  AND httpRequest.status=401' --project ourlab-0808 --freshness=5m   --format="value(timestamp,httpRequest.requestUrl)"
```

## 8. 데이터 시딩 (최초 1회, 완료됨)

에뮬레이터 → 운영으로 옮겼다. REST 문서 표현이 양쪽 동일해 타입 변환이 필요 없다.

- **Firestore 7,173건**: 수업 7,109 + 커뮤니티/DM/알림/별자리/유저 + 서브컬렉션
  (쪽지·댓글·좋아요·이미지·노트)까지 `:listCollectionIds` 재귀. `:commit` 배치는
  **100건 단위**(300건은 페이로드가 커서 끊긴다). 문서 `name`은 URL이 아니라
  **리소스 경로**여야 한다. 에뮬레이터 REST는 `Authorization: Bearer owner` 필요.
- **Auth 8계정**: Identity Toolkit `accounts:batchCreate`. **`localId`(uid)를 반드시
  명시 지정**할 것 — Firestore의 `users/{uid}`, `follows`, `dm_threads/{uidA}_{uidB}`가
  전부 uid를 참조하므로 새 uid를 받으면 이관한 데이터가 통째로 고아가 된다.
  `x-goog-user-project: ourlab-0808` 헤더가 없으면 403이 난다.
- **룰·인덱스**: `firebase deploy --only firestore:rules,firestore:indexes`.
  ⚠️`storage`는 함께 배포하지 말 것 — 운영 프로젝트에 Storage가 아직 설정되지 않아
  실패한다(현재 게시물 이미지는 Firestore에 base64 데이터 URI로 들어 있어 지장 없음).
- ⚠️**복합 인덱스는 빌드에 몇 분 걸린다.** 그 동안 해당 쿼리는 500을 낸다 —
  "인덱스가 현재 빌드 중"이라는 뜻이지 코드 결함이 아니다. 에뮬레이터는 인덱스를
  강제하지 않으므로 이 문제는 **운영에서만 드러난다**.

시드 스크립트(`backend/scripts/*.py`)는 전부 `FIRESTORE_EMULATOR_HOST` 가드가 걸려
있어 운영에 직접 실행되지 않는다. 의도된 안전장치이니 풀지 말 것.

## 9. 시크릿 교체 (Anthropic 키)

값을 **절대 출력하지 말 것**. 검증은 길이·접두사·공백 유무만으로 한다.

```bash
# cmd.exe에서 실행 (PowerShell에는 printf가 없다).
# echo 금지 — 개행이 붙어 108자가 109자가 되고 인증이 실패한다.
<nul set /p="sk-ant-..." > "%TEMP%\k.txt"
gcloud secrets versions add ANTHROPIC_API_KEY --project=ourlab-0808 --data-file="%TEMP%\k.txt"
del "%TEMP%\k.txt"

# 새 인스턴스가 latest를 집도록 리비전 교체
gcloud run services update ourlab-backend --project=ourlab-0808   --region=asia-northeast3 --update-env-vars=KEY_ROTATED_AT=YYYY-MM-DD

# 확인 후 옛 버전 비활성화
gcloud secrets versions disable <N> --secret=ANTHROPIC_API_KEY --project=ourlab-0808
```

⚠️`gcloud`가 cmd 창의 PATH에 없으면 `&&` 체인이 첫 명령 뒤에서 끊겨 **키만
`%TEMP%\k.txt`에 평문으로 남는다**(실제로 발생했다). 업로드 후 시크릿 버전이
정말 늘었는지 `gcloud secrets versions list`로 확인하고, 임시 파일이 남아 있으면
반드시 지울 것.

⚠️시크릿 비활성화는 "우리 서버가 안 쓴다"는 뜻일 뿐이다. 노출된 키 자체의 무효화는
console.anthropic.com에서 삭제해야 한다.

## 10. 남은 항목

1. **PIPA 국외이전 고지** — 서비스가 공개 접근 가능해졌으므로 홍보 전 필수.
   Anthropic(미국)·Google Cloud로 데이터가 나간다.
2. **Firebase Storage 미설정** — 실사용자 이미지 업로드를 열려면 콘솔에서 활성화.
3. **모니터링 없음** — 애널리틱스 0건, 5xx 알림 없음. 지금은 `gcloud logging read`가 유일.
4. **학생증 인증 미이관** — 현재는 사전 인증된 데모 계정으로 대체 중이라, 신규
   가입자가 연세대 인증을 받을 경로가 없다.
5. **`OPENAI_API_KEY`·`SOLAPI_*`** — `.env`에는 있으나 `app/` 어디서도 참조되지
   않는다(계획 당시 미해결이었고 여전히 동일). Secret Manager에 안 넣어도 지장 없다.

> 계획 당시 "판단 필요"로 남겼던 항목 중 App Hosting 병행·리전·Postgres 처리·todos
> 이관은 모두 결론이 났다: App Hosting 폐기 / 서울 `asia-northeast3` / Postgres는
> 라우터 등록 해제로 분리(파일 보존) / 일정(todos) 기능 제거.
