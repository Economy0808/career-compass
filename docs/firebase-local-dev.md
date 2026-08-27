# Firebase 로컬 개발 가이드

## 에뮬레이터 실행

```
firebase emulators:start --only auth,firestore,storage --project demo-ourlab
```

리포 루트(`firebase.json`이 있는 곳)에서 실행한다. 처음 실행 시 Firestore
에뮬레이터가 Java 런타임을 요구하므로, 로컬에 JDK가 설치되어 있어야 한다.

**`--project demo-ourlab`을 반드시 붙일 것.** 이 플래그 없이 실행하면
`.firebaserc`의 `"default"` 별칭(`ourlab-0808`)으로 에뮬레이터가 뜨는데,
백엔드는 `demo-ourlab` 네임스페이스를 바라보고 있어서 서로 다른 프로젝트를
보게 되고 데이터가 텅 빈 것처럼 보인다.

## 포트

- Auth: 9099
- Firestore: 8080
- Storage: 9199
- Emulator UI: 4000 (`http://localhost:4000`)

## `demo-ourlab`가 뭔가

`.firebaserc`의 `demo` 별칭이다. 아직 실제 Firebase 프로젝트를 만들지
않았기 때문에 임시로 넣어둔 값이며, `demo-` 접두사가 붙은 프로젝트 ID는
에뮬레이터가 완전히 오프라인으로, 실제 GCP 프로젝트 없이 동작하게 해준다.
`firebase login` 없이도 로컬 개발이 가능한 이유가 이것이다.

**실제 Firebase 프로젝트를 만들고 나면 반드시 바꿔야 할 것:**

1. `.firebaserc`의 `"default"` 값을 실제 프로젝트 ID로 교체
2. 프론트엔드/백엔드의 Firebase 설정(`apiKey`, `projectId` 등)도 실제 값으로 교체
3. Firestore/Storage는 반드시 asia-northeast3(서울) 리전으로 실제 프로젝트를
   생성해야 한다 (PIPA 대응 - `CLAUDE.md` 및 아키텍처 결정 참고)

`.firebaserc`는 순수 JSON이라 파일 안에 주석을 넣을 수 없어서, 이 설명을
여기에 남겨둔다.

## 보안 규칙

`firestore.rules`, `storage.rules`는 클라이언트가 Firestore/Storage를 직접
호출하는 것을 전제로 작성되었다 (기존 FastAPI 백엔드처럼 서버가 앞단에서
막아주지 않는다). 규칙 변경 시 에뮬레이터로 먼저 검증할 것.

## 3터미널 로컬 개발 루프

로컬에서 프론트-백엔드-에뮬레이터를 함께 띄우려면 터미널 3개가 필요하다.

**① 리포 루트 — Firebase 에뮬레이터**

```
firebase emulators:start --only auth,firestore --project demo-ourlab
```

**② `backend/` — FastAPI (uvicorn 직접 실행)**

```powershell
$env:FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099"
$env:FIRESTORE_EMULATOR_HOST = "localhost:8080"
$env:FIRESTORE_PROJECT_ID = "demo-ourlab"
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

`--reload`를 붙이지 않는다. Windows에서 uvicorn `--reload`가 파일 변경을
못 잡아내고 옛 코드를 계속 서빙하는 경우가 있었다 (Windows reload 함정).
코드를 수정했으면 이 터미널을 직접 Ctrl+C로 끄고 다시 실행할 것.

**③ `frontend/` — Next.js 개발 서버**

```
npm run dev
```

세 터미널을 모두 띄운 뒤 `http://localhost:4000`(Emulator UI)에서
Auth/Firestore 상태를 눈으로 확인할 수 있다.
