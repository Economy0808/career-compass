# Firebase 로컬 개발 가이드

## 에뮬레이터 실행

```
firebase emulators:start --only auth,firestore,storage
```

리포 루트(`firebase.json`이 있는 곳)에서 실행한다. 처음 실행 시 Firestore
에뮬레이터가 Java 런타임을 요구하므로, 로컬에 JDK가 설치되어 있어야 한다.

## 포트

- Auth: 9099
- Firestore: 8080
- Storage: 9199
- Emulator UI: 4000 (`http://localhost:4000`)

## `demo-ourcompass`가 뭔가

`.firebaserc`의 기본 프로젝트 별칭이다. 아직 실제 Firebase 프로젝트를 만들지
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
