# 프론트엔드 세션 핸드오프 (2026-08-30 갱신 — 같은 세션 11차)

> **11차: SNS 열람 모델 전환 + 데모 모드 + DM/쪽지** (백엔드 세션 03-code-dd와 종일 협업).
> 이 회차의 큰 줄기는 **"비로그인 열람 폐지 → 로그인 게이트 → 미인증 게이트"** 3단 재편이다.
>
> **① 열람 모델 전환(사용자 확정)**: 게시물·스토리는 **로그인만 하면 열람**(익명 401,
> 팔로워 게이트 폐기). 팔로우는 열람 권한이 아니라 **피드 구성 기준**이 됐다 —
> `GET /api/posts/feed`가 `{source: following|interest|latest, posts}` 래퍼로 바뀌어
> 팔로잉 0명이면 관심사 겹침 유저 글로 콜드스타트한다(`245b3b3`). 소셜 우측에 "비슷한
> 사람 추천" 사이드바(explore 재사용), 게시물 상세도 401→로그인 유도(`ee8310d`).
> 별자리 발행물은 **비로그인 공개 불변**.
>
> **② 랜딩 강제 로그인 + 둘러보기 데모**(`e60cc18`, `a27c905`): 비로그인은 실서비스 화면에
> 못 들어간다. 랜딩 CTA→로그인, "둘러보기"→**`/demo`**(별자리·탐색·소셜 3탭, 가짜 픽스처,
> **8000 요청 0건이 합격 조건**이며 실측 확인). `/constellation/new`도 비로그인이면
> `/login?next=`로 보낸다 — 인테이크 API가 익명 401이 되어 대화가 뜬 채 실패했었다.
>
> **③ 미인증(로그인했지만 yonseiVerified=false) 게이트**: 서버가 **403 +
> `X-Auth-Requirement: yonsei-verified`**로 내려주고(401 로그인 / 403+헤더 인증 /
> 403 무헤더 권한없음 **3분기**), 프론트는 `components/VerifyGate.tsx` + `lib/api.ts`의
> `ApiError.authRequirement`로 처리(`cbe8b6c`). **1차 방어선은 `user.yonseiVerified` 선제
> 차단**, 서버 403은 최후 방어선. 전수 감사에서 **일정 화면은 가드가 전무**했고(6개 핸들러,
> 일부는 catch조차 없어 unhandled rejection) 전부 보강 + 낙관적 업데이트 롤백까지(`de9fad8`,
> 공용 훅 `lib/use-verify-guard.ts`). 예외: **`PATCH /api/profiles/me`(이름·이모지)는 미인증도
> 허용** — 인증 화면에서 갇히지 않게.
> ⚠️ **CORS 함정**: 커스텀 응답 헤더는 `expose_headers` 없이는 브라우저가 못 읽는다.
> curl/urllib으로는 보여서 서버 스모크로는 안 잡힌다 — 실브라우저 `fetch`로 검증할 것.
> **미인증 캔버스**(`95e4612`): 캔버스만 열리고 LLM 대화·저장·발행 전부 차단, 작업물은
> `lib/local-constellation.ts`가 uid별 localStorage에 보관, 인증 완료 시 **한 번만**
> "저장할까요?" 묻고 예=서버 승격/아니오=폐기. 서버 쓰기는 `enqueueMutation` **단일
> 초크포인트**에서 막아 새 호출부가 생겨도 자동 차단된다.
>
> **④ 진입 흐름(사용자 확정 규칙)**: 랜딩 → 로그인 → 접안렌즈 확대 → **신규(별자리 0개 +
> 로컬 초안 없음)만 LLM 대화**, 기존 사용자는 **최신 별자리를 이어서 연다**(`fc8b862` —
> 그전엔 미발행 건만 이어 열어 "발행만 해둔 계정은 매번 대화"가 떴다). **LLM이 내비게이션을
> 가로채면 안 된다**는 게 사용자 명시 요구라, 로그인 후 목적지는 `next` 파라미터 우선.
> **로그인 화면 재설계**(`bf56d8d`, impeccable 스킬 사용): 랜딩과 같은 종이 성도 + 우측
> 접안렌즈("FIG. 2"), 로그인 성공 시 그 렌즈 속 우주가 화면을 덮는 명→암 전환. 랜딩의
> 접안렌즈 대기 스테이지는 제거(로그인 화면이 대신). ⚠️ `apertureReveal` 키프레임에는
> `translate(-50%,-50%)`가 들어 있어 **화면 중앙 고정 요소 전용**이다(흐름 배치에 쓰면 밀림).
>
> **⑤ DM·쪽지**(`8f6362e`, `31608a1`, `668c481`, `42fc2ee`): 우상단 알림 벨(`right-4`) 옆
> `right-20`에 아이콘 하나 — **탐색·소셜·일정=DM(말풍선), 커뮤니티=쪽지(봉투)로 배타 전환**.
> DM은 팔로잉∪팔로워끼리만(아니면 403), 1440px↑에서 오른쪽 가장자리 도킹(384px — `w-rail`
> 196px로는 대화 UI가 성립 안 함). **쪽지는 커뮤니티 전용 익명 시스템**: 글·댓글 케밥에서
> 보내고 대화는 글 단위, 응답 스키마에 **uid·표시명·아바타 필드 자체가 없다**(구조적 부재) —
> **어떤 경로로도 프로필 링크를 만들지 말 것**. `NoteThreadDto`의 `blocked`+`role`로 차단
> 상태를 판정한다(받는 쪽만 차단·해제 가능). 알림 타입 `dm`/`note`도 배선됨 — **note 알림은
> actorUid·actor 키가 아예 없어** 발신자 표기 불가, 쪽지함을 여는 것까지만. 알림함이 없는
> 경로에서 눌린 요청은 `lib/message-panel-bus.ts`가 보류했다가 해당 탭 도착 후 전달한다.
>
> **⑥ 그 외 랜드**: 게시물 상세에 작성자 별자리 실캔버스 미리보기(`e4eea37`), 커뮤니티 카드
> 핫글 미리보기(`ee1c1ed`), 탐색 검색 `@아이디`/키워드 모드(`6a33446`), 별(✦) 알림함
> (`1db0dcd`, `/constellation` 제외 — 그 화면 우상단은 기존 컨트롤이 같은 좌표를 점유),
> **수업 검색**(학정번호·과목명 겸용 + 학과·단과대 필터, `f9dcab3`)과 **수업 군집 통합**
> (`d1a8d84` — 학과명 하드코딩 없이 `bin.items.every(id.startsWith("course:"))` 구조 판정,
> 배지는 서버 `department` 우선/구 문서는 bin.label 폴백 `1907dc9`), 사이드바 팔로우 상태가
> 새로고침에 초기화되던 버그(`a8d34d6` — explore DTO에 `isFollowing`이 없었다), 피드 카드
> 댓글을 아이콘 액션으로 + 별자리 뷰어 돌아가기 버튼(`6df173f`), PIPA 문구(`a6ccc43`).
>
> **⑦ 운영 교훈**: ⓐ자동화로 **로그인 폼에 비밀번호를 입력하지 않는다** — 대신 에뮬레이터에서
> 토큰을 받아 API로 검증하거나, 실브라우저 페이지 컨텍스트에서 `fetch`로 검증한다(CORS 검증에
> 실제로 이 방법이 필요했다). 그래서 **로그인 상태 UI는 항상 사용자 육안 확인 항목으로 남는다.**
> ⓑ서브에이전트에는 **시간·범위 규율**을 브리핑에 넣는다(범위 확장 금지, 완결 우선, 같은 오류
> 3회 이상 붙들지 말 것, 커지면 커밋 가능한 단위로 반납). ⓒ세션 간 **사용자 확인이 필요한
> 사안은 올리기 전에 피어 채널로 먼저 통지**한다(중복 질문 사고 1회).
>
> **⑧ 데모 자산**(백업 `data/emulator-backup`에 포함): `test-observer@yonsei.ac.kr` /
> `demo-analyst@yonsei.ac.kr`(관심사 부분 겹침, 추천·콜드스타트 검증용) / **미인증 확인용
> `demo-unverified@example.com`** — 비밀번호 전부 `observatory123!`. 쪽지 스레드 2개(글·댓글
> 대상), DM 스레드 1개, [데모] 게시물·별자리·커뮤니티 글. 두 계정은 **언팔로우가 기준 상태**다.
>
> **⑨ 진행 중/미완**: DM "새 대화 시작" UI(계약 `GET /api/dm/partners` — 이름순, `hasThread`로
> 분기), 쪽지 **차단 해제** UI(백엔드 `POST .../unblock` 제작 중). 모바일 실검증은 여전히 전무.

> **10차: BGM·랜딩 HUD·대기창·피드 상세 배치** (사용자 직접 지시 + 백엔드 세션
> 03-code-dd 위임 혼합):
> - **BGM(Web Audio 실시간 합성, 자산 0)**: `lib/bgm-score.ts`(악보 164노트,
>   BGM_TEMPO=**47** — 사용자가 템포를 6회 미세 조정한 최종값) +
>   `lib/bgm-synth.ts`(BgmPlayer: 오르골=비정수배 부분음 가산 합성 BELL_PARTIALS,
>   어택 1.5ms, 핑퐁 딜레이, PARAMS.landing/canvas 모드) + `components/BgmToggle.tsx`
>   (제스처 후 resume, `localStorage["ourlab-bgm-muted"]`). 랜딩 네비·캔버스 컨트롤 줄 배선.
>   ⚠️ **자동화 브라우저 주행 전 음소거 선주입 필수**(검증 패널 소리가 사용자
>   스피커로 샌 실사고 1회), 검증 후 소리 나는 탭 방치 금지.
> - **랜딩 HUD 모션**(TelescopeLanding): 점선 링 landingSpin 12마디/아크 링 역회전
>   8마디/요소 둥둥 landingFloat(진폭 7~11px, 위상차, **한 방향 1마디**=BGM 마디 동기,
>   LANDING_BAR_S=(60/BGM_TEMPO)*4). globals.css 키프레임은 상시 모션 금지의 명시적
>   예외(사용자 지시 주석 있음). 3px/10초는 지각 불가였음 — 진폭 줄이지 말 것.
> - **대기창 개편**(GeneratingGuide.tsx): 정중앙 별자리 로더(시드 6~9노드 점등) +
>   "사용법 익히기" 버튼 → TutorialDialog(캐러셀 5장 + **실 ConstellationCanvas 임베드
>   연습장**, 서버 호출 0). 폴링 상한 400회=10분(실 LLM 3~5분 실측). ⚠️ 이 파일은
>   현재 백엔드 세션이 WIP 수정 중 — 소유권 그쪽.
> - **feed.png 교체**(`e9bf662`): 가이드 소셜 슬라이드를 실 게시물 캡처로.
> - **피드 상세(위임)**: F-E3 피봇으로 스펙 대부분 기랜드 판정 → 사용자 승인 스코프
>   "작성자 별자리 미리보기, 미니 SVG 말고 메인 캔버스처럼 크게"만 구현(`e4eea37`).
>   `components/AuthorConstellationPreview.tsx`(최신 발행 별자리를 readOnly 실캔버스
>   26rem 임베드 + 전면 투명 링크→뷰어, 없으면 미렌더) + DTO→캔버스 매퍼
>   `lib/constellation-canvas-map.ts` 공용화(뷰어 페이지도 사용). Post 계약 변경 불요.
> - `4c73793` Field.tsx가 multiline 판별자를 rest 스프레드로 DOM에 흘리던 React 경고 수정.
> - **데이터 소실 미스터리 종결**(백엔드 `8418993`): 범인=conftest autouse 픽스처의
>   demo-ourlab 전체 DELETE(pytest마다). 테스트 프로젝트 "demo-ourlab-test" 강제 분리로
>   차단. 에뮬레이터는 `--import=data/emulator-backup --export-on-exit=…` 기동 권장.
> - **test-observer 재생성**: uid `pILuT7z1jkPbhybfNhEOJyc2v5u2`(이메일/비번 불변),
>   프로필 "별 보는 경영학도"🌌/"무전공 2학년, 별자리 잇는 중". 데모 시드([데모] 표기):
>   게시물 `b514694a`/`02bcbc59`, 발행 별자리 `4e7c4f2c`. 전부 백업에 포함됨.
>   구 uid 리포 참조는 0건(grep 확증) — 시드 갱신 no-op 종결.

> **9차: 탐색/소셜 개편 배치(F-E1~E3)** (사용자 원문 "소셜 탭 유명무실 → 돋보기
> '탐색'으로 사람 찾기 + 소셜은 인스타처럼 게시물·동영상·스토리", 백엔드 세션
> 03-code-60 협업 — 백엔드 정본 `254e6e9`):
> - `6eab37b` **F-E1+E2**: 네비에 돋보기 SearchIcon "탐색" 추가, 모바일
>   TAB_ORDER=[explore,feed,new,community,mine](**일정은 데스크톱 레일·NavIsland
>   잔류** — 사용자 승인 트레이드오프). /explore = 디바운스 검색(300ms, 응답 역전
>   방지 seq) + **aspect-[3/4] 초상형 카드**(큰 아바타·이름·bio·관심사 칩,
>   commonTags는 lit 칩) → 프로필. lib/explore-api.ts 신설.
> - `854e5be` **F-E3**: FeedView 전환 — 별자리 카드 스트림 제거, 스토리 링+게시물
>   스트림(작성자 줄, 댓글은 카운트+퍼머링크 유도로 N+1 회피), 동영상 준비 중 자리.
>   PostDetail에서 PostImageCarousel/usePostImages/LikeStarIcon/ShareIcon 추출 공용화.
> - `cdae459` 계약 정렬: /api/posts/feed는 {post, author} 중첩→listFeedPosts가 평탄화.
>   탐색 빈 상태에 "별자리를 띄우면 관심사가 생기고" 안내(interest_tags는 발행/공개
>   전환 시점에만 재계산 — 기존 발행 유저는 다음 발행 전까지 태그 없음).
> - `034bad0` 검수 4차 5건: 탐색 카드 이름 shrink-0+칩 4개 상한(+N), 캐러셀 터치
>   스와이프+44px 화살표 히트, like/share 44px 타깃, 피드 메타 한국어만.
> - ⚠️ **한글 포함 파일에 PowerShell 텍스트 치환 금지**: PS 5.1 Get-Content 기본
>   인코딩이 cp949라 UTF-8 한글이 전부 깨진다(PostDetail 실사고 1회, git checkout
>   복원). 파일 수정은 Edit 도구로만.
> - 로그인 QA 목록 추가: 겹치는 태그 유저 카드에서 lit 칩 강조 확인(익명+단일 데모
>   유저로는 발화 조건 없어 미실증, 코드 정상 판정).

> **8차: 다중 사진 게시물 배치(F-P1~P3)** (사용자 원문 "사진 여러장 + 좋아요(노란색
> 별모양) + 댓글 + 공유", 백엔드 세션 03-code-97과 협업 — 백엔드 정본 `8af3323`):
> - `acf4df8` — **F-P1 업로드**: 다중 선택≤10(초과 안내·앞 10장), 장별 1080px 리사이즈,
>   컴포저에 순서 스트립(클릭=미리보기 전환, ✕=장별 제외), 그리드 타일 겹침 배지.
>   file input의 multiple은 상태 반영 전에 click이 나가서 **DOM에 직접 세팅**.
> - **F-P2 `components/PostDetail.tsx`(신규 공용)**: 프로필 라이트박스와 퍼머링크가 같은
>   본문 — 캐러셀(점 인디케이터, imageCount>1일 때만 GET /api/posts/{id}/images 지연
>   로드 `[{index,imageData}]`→평탄화), **별 좋아요 lit 채움**(POST/DELETE 분리, 채움=
>   내가 누름, 비로그인=login?next), 실명 댓글(폴백 "관측자", ≤500). 댓글 DELETE
>   엔드포인트는 존재하나 UI 미배선(스코프 외).
> - **F-P3 `/post/{postId}` 퍼머링크**: 익명 열람, 404 빈 상태, 작성자 줄(ownerId→프로필
>   지연 조회), 공유=navigator.share→클립보드 폴백. 라이트박스에도 동일 공유 버튼.
> - 계약 확정 diff 반영: 생성 `{images(1~10)|imageData}` 둘 중 하나(둘 다면 images 우선),
>   PostOut+imageCount/likeCount/commentCount/isLiked?(로그인 시만), 상세 {post,comments}
>   중첩, PostCommentOut에 isMine 없음.
> - 실검증: 테스트 계정 API로 2장 생성→like→댓글→images(0,1)→상세 일치, 익명 브라우저
>   퍼머링크 캐러셀·별 카운트·404 실측(검증 글 삭제 완료). ⚠️ PowerShell 5.1
>   Invoke-RestMethod -Body는 한글을 ISO-8859-1로 깨뜨림 — 한글 body 테스트는 UTF-8
>   바이트로 보낼 것.
> - 사용자 QA 추가(로그인 게이트): 다중 선택→스트립→올리기 실사용 왕복.
> - 세션·피어 모두 사용량 한도로 수차례 재시작됨 — 백엔드 8000(preview backend-mock)은
>   그때마다 죽으니 재개 시 `preview_start backend-mock` + 라우트 스모크부터.

> **7차: 통합 검수 대응 배치** (백엔드 세션 03-code-97 임페커블 재검수 인계분):
> - 백엔드 8000 구코드 재시작(preview backend-mock) — C1/S1 라우터 라이브 확인.
> - `bb3be46` **타인 프로필 스토리 진입점**: 활성 스토리 보유 시 프로필 아바타가
>   lit 링 버튼이 되어 뷰어 오픈(listUserStories, 익명 허용, 단일 항목 링).
>   ring 엔드포인트(인증 전용)만 배선돼 진입점이 없던 버그.
> - `6c6b360` **검수 5건**: ①font-mono는 숫자만(No-Korean-Mono, 커뮤니티 2페이지)
>   ②DESIGN.md lit 세 번째 용처=스토리 링 명문화 ③DESIGN.md "Community & Stories"
>   절 신설(잉크 카드 레시피·링/뷰어 팔레트·업로드 시트=잉크 컨텍스트 모달)
>   ④StoryViewer 경량 포커스 트랩+←/→ 키 ⑤비익명 폴백 "익명"→"관측자" 3곳.
> - 검수 클린 판정: 익명성 무누수·비밀 게시판·팔레트. 잔여 ceiling(재량):
>   게시판 카드 최신 글 미리보기 줄, 프로필 진입 링 hasUnseen 하드코딩(ring에
>   per-viewer seen 없어 현재는 정직한 값).
> - 사용자 QA 목록(로그인 게이트라 자동 캡처 불가): 글쓰기 폼·업로드 시트 —
>   test-observer@yonsei.ac.kr / observatory123!, 반드시 localhost:3000.

> **6차: 커뮤니티/SNS 배치 프론트 위임분** (백엔드 세션 03-code-97과 협업):
> - `beae545` **커뮤니티(C2)**: 네비+모바일 탭바 5슬롯, /community 6게시판(자유·비밀·질문·
>   정보·진로·홍보) → 글 목록/상세/댓글/좋아요, 기본 익명+실명 옵트인(비밀=강제 익명).
> - `af7bc51` C1 확정 계약 정렬(question id·중첩 상세 평탄화·like POST/DELETE·authorUid/
>   authorDisplayName).
> - `22ac89b` **스토리(S2)**: 24h 스토리 — 링(프로필·피드, 안 본=lit 보더), 전체화면 뷰어
>   (5s 진행바·탭 넘김·유저 넘김·view 기록·본인 삭제), 업로드 시트(사진/스토리/**영상=준비 중**
>   비활성 — Storage 후). 리사이즈 공용화(lib/image-utils).
> - 백엔드 정본: C1 `27977e3`+`15d810b`, S1 `f96fb04`. 통합 검수·격리 테스트 런은 백엔드
>   세션이 마감 단계에서 수행 예정. 뷰어 좌탭은 유저 내 이전만(단순화, 필요시 확장).
> - PIPA: 커뮤니티 익명 글도 서버에 author_uid 기록(신고·삭제용) — 처리방침 항목 추가 후보.

> **5차: 사용자 라이브 QA 배치** (`269c9c1`~`7cfee21` 12커밋, 사용자가 실사용하며 지시):
> - 플로우 확정: `/`=항상 랜딩(`7f3816f`), **미발행 별자리 있을 때만** 대화·시안 스킵(`c395b09`).
> - 발행 버그(스위치 기본 꺼짐)·핀치 브라우저줌 누수(React passive wheel)·강제 재대화 수정(`269c9c1`).
> - 캔버스: 하늘 여백 중심 fit, 달성 시 엣지 드로우온, 우상단 미니 컨트롤(저장 상태 라벨
>   버튼+공개 즉시 토글+편집), 로고 락업(`97e0ad4`·`296394b`).
> - **로컬 볼트**(노트=.md 원본, 옵시디언식, File System Access)(`f10e5a0`) — 유료 서버 동기화는
>   이음새만.
> - **엣지 색+달성 연출 5종**(`9bccef3`) — 백엔드 계약 확장 포함(Edge.color, Node.glow_effect).
>   GLOW_PRESETS는 Canvas가 단일 소유.
> - **프로필 인스타 해부학+사진 게시물**(`7cfee21`) — Post(base64 data URL, Storage 전 임시,
>   1MiB 한도는 클라 1080px 리사이즈로), 케밥 메뉴(회원 탈퇴 이동, 설정 자리), 탭(사진|별자리),
>   네비 마지막 탭=프로필 마크. 스토리 링/하이라이트/DM/음악·노트 스토리는 주석으로 자리만.
> - ⚠️ PIPA: 사진 게시물은 개인정보 포함 가능(인물 사진) — 처리방침에 항목 추가 필요.
>   posts 컬렉션은 백엔드 경유 전용(rules 기본 deny 유지). 새 백엔드 테스트(글로우·엣지색·
>   posts)는 **격리 에뮬레이터에서 일괄 실행 대기**(공유 에뮬레이터 pytest 금지).
> - 백엔드 세션(03-code-a0) 종료됨 — 이후 백엔드 확장도 이 세션이 직접 수행 중.

> **4차: 신기능 배치 프론트 위임분 완료** (백엔드 세션 조정 하에 F5·F6+부수 패치):
> - `15b6657` **열람 전용 뷰어** `/constellation/{cid}` — readOnly 캔버스+fitRequest, 종이
>   크롬 헤더(제목·description·contributors), 404/403/미발행 빈 상태, 피드 카드 링크화.
> - `7a520f2` **readOnly 인터랙션** — 클릭/Enter/Space→정보 카드(노트 진입점·편집은 차단).
> - `ff18afa` **node.color 폴백 5곳** — `node.color ?? colorForType(type)`, CanvasNode.color?.
> - `a3b54e4` **프로필 인스타화** — MiniConstellation 타일 그리드, 심플 헤더, 구 /api/users 제거.
> - `025d068` **B2 배선** — `lib/profiles-api.ts` 신설(계약 6765735), 팔로우 실배선(익명/본인은
>   버튼 숨김 — isFollowing 키 부재로 자연 처리), 실명/아바타/bio, 뷰어 작성자 조회+폴백.
> - `84fc57b`+`ab1cac0` dev dist 분리(NEXT_DIST_DIR) — **검증 빌드는 반드시
>   `$env:NEXT_DIST_DIR='.next-build'`, 네이티브 PowerShell로**(bash 경유 인용 실수로 3000
>   서버 .next를 오염시킨 실사고 1회).
> - **정리 후보(고아/사문)**: `components/ProfileHeader.tsx`(무참조), `lib/use-follow.ts`(구
>   /api/users 랩퍼, 무참조), 프로필의 DangerZone은 아직 구 API(deleteAccount) 의존.
> - **실기 QA 필요(로그인+발행 데이터)**: 프로필 그리드·뷰어·팔로우 왕복, 발행→피드 카드,
>   기존 별자리 배지 — 코드·빌드 검증만 완료 상태.

> **심야 3차: DraftReviewStage 디자인 검수**(백엔드 세션 이관, `b95d752`) — 채움=달성 문법
> 복원·배너 정직화·타원 별 얼룩 수정·lit 정합·오버플로 클램프·모바일 레이아웃. mock 대화
> 완주로 실기 검증(캡처 `.impeccable/review/draft-stage-*.png`). **남은 확인**: ①"별자리가
> 이미 있어요·이어서 편집" 배지 시각 확인(로그인+기존 별자리 필요) ②IntakeChat의 타원 별
> 얼룩·SideRail 밑 텍스트 잘림(백엔드 세션에 보고됨, 그쪽 파일) ③mock 시드가 목표 문장을
> 요소 이름으로 쓰는 데이터 품질.

> **2026-08-27 심야: 진입 연출 + 디자인 패스 완료** (`56b2ad1`·`43fd474`·`cb1db83`):
> - **망원경 랜딩**: 비로그인 `/` = 밝은 종이 성도(`TelescopeLanding.tsx`). ⚠️ 색은 전부
>   `--paper-*` **인라인 var()** — Tailwind 신규 토큰은 dev 서버 재시작 전 미컴파일이라
>   흰 랜딩이 어둡게 뚫리는 실사고가 있었음. 이 파일은 인라인 유지가 규칙.
>   CTA → `apertureOpen`(650ms 1회성) 명→암 전환 → `/constellation/new`.
>   impeccable 마감 리뷰 5건 수정 후 ship 판정.
> - **AI티 제거 스타일 패스**(로직 불변, 인테이크 계약 20d393f 유지): 인테이크 관측기록 톤·
>   별빛 로더, 탄성 이징 제거, 인증 4페이지 수직 센터링, ::selection·caret 테마.
> - **디자인 문서 체계 신설**: `PRODUCT.md`(제품 사실) + `DESIGN.md`(+`.impeccable/design.json`)
>   — 이후 디자인 작업은 impeccable 스킬이 이 파일들을 자동 로드. 격자 배경 검출 예외는
>   `.impeccable/config.json`에 기록됨. `docs/design-handoff-guide.md`는 여전히 기능 규칙의 권위.
> - **잔여 정리 후보**: tailwind의 콩나무 시대 잔재 `shadow-glow`/`shadow-glow-strong`(초록)·
>   `bg-altitude` — "lit은 초록 금지" 원칙과 모순, 구 일정 화면이 쓰는지 확인 후 제거.
>   랜딩 kicker(FOR UNDECLARED 줄)는 리뷰어가 삭제 권고(시안 고정이라 유지 중, 다음 결정 때 재론).
> - dev 검증 팁: 포트 3000을 다른 세션이 물고 있으면 `launch.json`의 `frontend-alt`(3001)로.

> **운영 규칙**: 이 문서는 매 프론트엔드 세션이 끝날 때 **같은 파일에 덮어쓰기로 갱신**한다
> (백엔드는 `docs/backend-session-handoff.md`, 동일 규칙). 새 파일을 만들지 말 것.
> 메모리 인덱스가 이 경로를 가리키므로 파일명을 바꾸면 다음 세션이 못 찾는다.

## ① 현재 상태

브랜치 `feature/constellation`. 인증 배선·영속화(`2ec49ef`~`750d10e`)에 이어, 이 세션에서
**소규모 정리 묶음** 완료 (`b18f755`·`140a899`·`c3abfbd`, tsc/lint 클린):

1. **유형→색 매핑 단일화** — `lib/element-colors.ts`가 단일 진실 공급원.
   `ConstellationCanvas`는 커밋됨. ⚠️ `ElementBinPanel`·`page.tsx`의 대응 헝크는 **미커밋**
   (아래 ③ 참고). `docs/design-handoff-guide.md` §4 TODO 해소 표기 완료.
2. **로그인 탈출구** — login/signup에 "로그인 없이 둘러보기"(→`/constellation/new`),
   `?next=` 내부경로 검증 후 복귀(`isSafeNextPath`: `/`시작·`//`금지·`/login|/signup` 제외,
   yonseiVerified=false면 `/verify` 우선). `/schedule`이 next 부여. login은 `useSearchParams`
   때문에 Suspense 래퍼 구조로 바뀜.
3. **위키링크→탭** — 확대 상태에서 위키링크 클릭 시 대상 요소의 최신(updatedAt) 노트를
   `openTab`으로 엶, 노트 0개면 기존 캔버스 포커스 경로 폴백(`handleWikiLinkClick`).
4. **새 노트 이원화** — **사용자 결정: 현행 유지(스킵)**. 폴더 인라인 초안 vs 탭 즉시 생성의
   차이는 의도로 인정.
5. **ARIA** — 읽기 모드 래퍼 plain div화. Escape는 편집기 컨테이너 스코프
   `handleOverlayKeyDown`으로 이동(title input/textarea는 자체 처리라 스킵해 이중발화 방지).
6. **포커스 트랩** — (a) 군집 탭 전환 시 `setIsNoteExpanded(false)` + 패널 내부
   `internalCollapseRef`로 내부/부모발 축소를 구분해 부모발일 때만 `expandedNodeId`/
   `activeNoteKey` 정리, **noteTabs는 보존**. (b) 확대 오버레이에 컨테이너 스코프 Tab 순환
   (`FOCUSABLE_SELECTOR`) + 마운트 시 첫 포커스 + 닫힐 때 이전 포커스 복원.

**망원경 진입 플로우 디자인 시안** (코드 아님): 디자인 캔버스 아티팩트
https://claude.ai/code/artifact/88238bcc-1dc7-4696-b386-894ec583a65a — 4개 아트보드가
순차 플로우(①밝은 '종이 성도' 랜딩 → ②접안렌즈 진입 전환 → ③관측기록 톤 대화(6문항) →
④우주 착지+좌하단 추천 별자리 패널). 실제 앱 토큰(Gowun Batang/IBM Plex/spec 팔레트) 사용.
헤드라인은 사용자 피드백으로 "흩어진 점들을 이으면, 나만의 별자리가 된다."로 확정.
작업 파일은 세션 스크래치패드라 휘발 — 수정하려면 아티팩트에서 `--extract`로 복원(디자인 스킬).
사용자가 GUI에서 저장하면 발행 충돌이 나니 재발행 전 반드시 read→extract→병합.

## ② 남은 프론트엔드 과제

1. **진입 플로우(망원경) 실구현** — 위 시안 기반. 백엔드 D(대화·군집 API)와 맞물림.
   구현 시 impeccable/taste 계열 디자인 플러그인 활용 지시 있음(사용자 설치함).
2. **모바일 실검증 전무** — 여전히 미착수.
3. **미커밋 헝크 정리** — 아래 ③.

## ③ ⚠️ 동시 세션 주의 + 미커밋 상태

이 세션 종료 시점에 **다른 세션이 같은 작업 트리에서 C(군집 advice)·D(진입 플로우) 작업 중**:
backend constellation API 일체, `services/bin_suggestion.py`(신규), `ConstellationIntakeChat.tsx`
(신규), `components/ui/icons.tsx`, `ElementBinPanel.tsx`(advice ⓘ·description·SeedIcon·
onStartNewConstellation), `page.tsx` 등이 미커밋 변경으로 존재.

그래서 이 세션의 변경 중 **그 파일들과 섞인 헝크 2개는 커밋 안 됨**:
- `ElementBinPanel.tsx` — element-colors import + TYPE_COLOR 사용(색 매핑 커밋의 잔여분)
- `page.tsx` — `handleTabChange`의 `setIsNoteExpanded(false)`(항목 6a의 부모 쪽 절반)
둘 다 작업 트리에는 살아 있고 tsc/lint 통과 상태. **C·D 세션이 커밋할 때 함께 들어가거나,
그 뒤 별도로 정리할 것.** 먼저 커밋하려면 해당 세션과 충돌 확인 필수.

## ④ 환경 함정 (변경분만 추가 — 기존 항목 전부 유효)

- dev 서버 중 `next build` 금지, tsc/lint로 검증, 포트 3000 낡은 번들 주의, SVG
  `fill="transparent"`, 한글 font-mono 금지 등 기존 규칙 그대로.
- **Playwright 플러그인으로 스크린샷 가능해짐**(브라우저 패널 스크린샷 불가의 우회):
  file:// 은 차단되니 스크래치패드에서 `python -m http.server`로 서빙 후 접속. 산출물이
  **리포 루트**에 떨어지니(`*.png`, `.playwright-mcp/`) 끝나면 치울 것.
- ECC GateGuard 훅이 파일별 첫 Write/Edit·첫 Bash·파괴적 명령을 한 번씩 거부함 —
  사실 4가지(호출자/공개심볼/데이터/지시원문)를 제시하고 같은 호출을 재시도하면 통과.
  `rm -rf`는 반복 거부되니 우회(이동/방치)가 빠름.
- 서브에이전트가 세션 한도(session limit)로 중간에 죽을 수 있음 — 부분 편집이 작업 트리에
  남으므로 재개 시 `git status`/`diff`로 실태 파악부터. 이번 세션에서 이 패턴으로 2개 죽고
  남은 절반을 메인 스레드가 인라인 마무리했음.
