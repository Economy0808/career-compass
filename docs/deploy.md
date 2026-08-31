# 배포 절차 (Firebase App Hosting + Cloud Run)

이 문서는 **설정 파일 준비 단계**에서 작성됐다. 아직 아무 배포 명령도 실행되지
않았다 — 여기 적힌 순서대로 **사람이 직접** 실행해야 한다.

## 목표 구성

- 프론트(Next.js 14, `frontend/`) → **Firebase App Hosting**
- 백엔드(FastAPI, `backend/`) → **Cloud Run**
- Firestore·Auth → 기존 Firebase 프로젝트 `ourlab-0808` 그대로 사용
- `/api/**` 요청은 Firebase Hosting rewrite로 Cloud Run에 연결 (firebase.json)
- 비밀키는 전부 Secret Manager. 코드·설정 파일에 실제 값 없음.

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
  --region asia-northeast3 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars APP_ENV=production,FIRESTORE_PROJECT_ID=ourlab-0808 \
  --set-secrets SECRET_KEY=secret-key:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,RESEND_API_KEY=resend-api-key:latest,DATA_GO_KR_API_KEY=data-go-kr-api-key:latest
```

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

## 6. App Hosting 배포 (프론트)

1. `frontend/apphosting.yaml`의 `REPLACE_ME_...` 값을 실제 Firebase 웹 앱
   설정값으로 채운다.
2. App Hosting 백엔드가 아직 없으면 생성 (최초 1회, 대화형):
   ```bash
   firebase apphosting:backends:create --project ourlab-0808
   ```
   GitHub 저장소 연결 여부, 루트 디렉터리(`frontend`), 리전(가까운 지원
   리전 선택 — 지원 리전 목록은 계속 바뀌므로 실행 시점에 CLI가 보여주는
   목록에서 고를 것)을 물어본다.
3. 배포:
   ```bash
   firebase deploy --only apphosting
   ```
4. Hosting rewrite(`firebase.json`)도 함께 반영하려면:
   ```bash
   firebase deploy --only hosting
   ```

## 7. 배포 후 확인 체크리스트

- [ ] `https://<app-hosting-domain>/` 접속 → 프론트 정상 로드
- [ ] `https://<app-hosting-domain>/api/health` (또는 Cloud Run URL 직접) → `{"status":"ok",...}`
- [ ] 로그인/회원가입 등 Firebase Auth 기반 플로우가 실제로 동작하는지
- [ ] 쓰기 요청(POST 등)이 403(origin not allowed)으로 막히지 않는지 → 3번
      항목의 `CORS_ALLOWED_ORIGINS` 갱신이 실제 배포 도메인과 일치하는지 재확인
- [ ] 403 응답에서 `X-Auth-Requirement` 헤더가 브라우저에서 실제로 읽히는지
- [ ] `/api/auth/*`, `/api/users/*` (Postgres 의존)를 쓰는 화면이 있다면 —
      Cloud SQL 없이 배포했으므로 이 부분만 에러가 나는 게 정상인지, 아니면
      이 시점까지 Firestore로 옮겨야 하는지 재확인 (2번 항목 참고)

## 발견한 걸림돌 / 판단이 필요한 항목 (임의로 결정하지 않고 보고)

1. **App Hosting + 클래식 Hosting rewrite 병행 여부 미검증** (4번 항목).
   실제 배포 후 첫 확인 대상 1순위.
2. **`OPENAI_API_KEY`, `SOLAPI_API_KEY`, `SOLAPI_API_SECRET`**이
   `backend/.env`에는 있지만 `app/config.py`의 `Settings`에도, `app/` 내
   다른 코드에서도 참조하는 곳을 찾지 못했다 — 죽은 설정값인지, 아직 안 쓰는
   예정 기능인지 확인 필요. 확인 전까지는 Secret Manager에 안 넣어도 배포에
   지장 없음.
3. **레거시 Postgres 세션 인증**(`app/core/deps.py`, `/api/auth/*`,
   `/api/users/*`)을 이번 배포에서 그대로 죽은 채로 둘지, Cloud SQL을
   붙일지, Firebase Auth 기반으로 마저 이관할지는 이 작업 범위 밖 — 결정
   필요.
4. **`todos` Firestore 이관**이 이 문서 작성 시점에 다른 세션에서 진행
   중이었다. 이관이 끝난 뒤 앱 임포트/기동을 재확인할 것 (2번 항목).
5. **App Hosting 리전**을 이 문서에서 확정하지 않았다 (지원 리전이 자주
   바뀌어 배포 시점에 CLI가 제시하는 목록에서 고르도록 안내만 함). Cloud Run은
   `asia-northeast3`(서울)로 확정했으나, App Hosting이 같은 리전을 지원하지
   않을 수 있다 — 배포 시 확인.
