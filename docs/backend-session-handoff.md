# 백엔드 세션 핸드오프 (2026-08-27 작성, 2026-08-30 22차 갱신)

> **22차 (8/30) — 사용자 육안 확인 지적 8건 처리. 절반이 "코드가 아니라 데이터" 문제였다**:
> - **⚠️최대 교훈 — 증상을 코드 탓으로 먼저 몰지 말 것.** 8건 중 3건이 데모 데이터 문제였다:
>   ① **"미인증 계정에 캔버스 대신 이메일 인증 화면"** → 연세대 인증 게이트와 **무관한 별개의
>      이메일 인증 벽**이었다. `demo-unverified` 계정의 `emailVerified=false`가 원인.
>      Auth 에뮬레이터에서 true로 교정해 의도한 상태(이메일 인증됨 / 연세대 미인증)로 만듦.
>      **두 게이트를 혼동하지 말 것** — 로그인 후 막히면 어느 벽인지부터 구분하라.
>   ② **"댓글에 쪽지 케밥이 없다"** → **코드는 이미 있었다**(`31608a1`에서 글과 같은
>      `NoteKebabMenu`를 댓글에도 부착, 브라우저 실측으로 확인). 데모에 댓글이 **1개뿐이었고
>      그 작성자가 본인**이라 "본인 댓글엔 케밥 미노출" 규칙에 걸려 안 보였던 것. 글 3개에
>      작성자를 엇갈리게 댓글을 심어 해소.
>   ③ **"추천 목록이 사라짐"** → 설계대로(팔로우한 사람 제외)인데 **실계정이 3개뿐**이라 0건이
>      된 것. 서버 폴백 + 데모 계정 5개 시드로 해소.
> - **`e0e9fa1` 접안렌즈 회귀 복원**: `b6bbeb0`(시안)이 만든 **가운데 정렬 접안렌즈 대기
>   스테이지**를 `bf56d8d`(로그인 재설계)가 **통째로 삭제**하고 확대 연출만 로그인 폼 위에
>   얹어, "클릭하던 화면에서 렌즈만 혼자 커지는" 회귀가 났다. 스테이지를 독립 화면으로 복원:
>   로그인 → **ApertureStage(가운데 렌즈+문구)** → 클릭 → 확대 → 목적지. 목적지 규칙
>   (신규=LLM / 기존=이어서 / `next` 우선)은 불변. ⚠️`apertureReveal` 키프레임에
>   `translate(-50%,-50%)`가 내장돼 있어 Tailwind translate와 충돌 가능 — 복원 시 확인 필수.
> - **`e5a5981` 추천 2단 폴백**: 1순위=관심사 겹침(기존 랭킹·`commonTags` 불변) → 30 상한에
>   못 미치면 2순위=**관심사 무관 미팔로우 유저**(본인·팔로우·1순위 중복 제외, 표시명순).
>   응답 필드 추가 없음(2순위는 자연히 `commonTags: []`). `search`는 불변. 테스트 18개.
> - **`3653cbd` 데모 계정 5개 시드**: `backend/scripts/seed_demo_explore_users.py`(에뮬레이터
>   이중 가드·멱등, 이메일로 매칭). `[데모] 현우/소민`(기존 계정과 관심사 겹침=1순위 검증),
>   `[데모] 지호/아름`(겹침 없음=2순위), `[데모] 태인`(태그 없음). 전 계정 비번
>   `observatory123!`, `yonsei_verified: true`. 실측: 모든 계정이 5~7명을 본다(이전엔 팔로우
>   한 번이면 0명). **기존 3계정·팔로우 관계는 무접촉.**
> - **프론트(이 세션 직접 위임)**: `77efadc`·`e652bdf`·`7f03c81`(**미인증 클릭 전면 차단** —
>   사용자 스펙 강화: "비인증 유저는 커뮤니티, 소셜, 탐색 창 들어가서 아무 클릭도 못해야".
>   게시판·글 진입, 게시물·프로필·스토리, 검색창(readOnly)·유저 카드. 기존 `VerifyGate`
>   재사용, 비로그인 분기 무접촉) / `8598e8d`(**요소 회수** — 캔버스 노드를 `#panel-bins`로
>   드래그(포인터업 시 `elementFromPoint` hit-test) 또는 회색 칩 클릭, 둘 다 기존
>   `handleNodeDelete`로 수렴해 간선 cascade 정리·미인증 로컬 모드 동작) / `e90ce1c`(추천
>   사이드바 **슬롯 항상 렌더** — null 반환 제거, 로딩/에러/빈 구분).
> - **⚠️운영 교훈 — 동시 커밋 오염**: 여러 에이전트가 **같은 작업 트리**에서 동시에 커밋해
>   서로의 파일이 커밋에 딸려 들어가는 사고가 **3회** 발생했다(각자 `git reset --soft`로
>   복구). `git commit -- <pathspec>`도 **워킹트리 내용을 가져오므로** 인덱스만 조작해선
>   못 막는다. 대책: 동시 에이전트에게 파일 소유권을 명시하고, 커밋 직전 `git status --short`
>   확인을 의무화할 것. 진짜 격리가 필요하면 worktree를 쓸 것.
> - **⚠️워치독 규율**: 서브에이전트 스폰과 **같은 응답에서** `sleep 600` 워치독을 걸 것
>   (사용자 지적으로 메모리에 상시 규칙으로 등록됨). 만료 시 **git log/status 먼저 확인** →
>   체크인 → 재장전.
> - **확정 사항**: DM 알림에 발신자 이름 표시는 **현행 유지**(사용자 확인: "6번은 괜찮아
>   이름떠도 돼"). 쪽지 알림의 익명성만 절대 불변.

> **21차 (8/30) — DM + 커뮤니티 익명 쪽지 (익명성이 최우선 제약)**:
> - **사용자 지시 원문**: "DM, 쪽지기능 만들자. 커뮤니티 제외한 일정, 탐색, 소셜 창에서는
>   알림아이콘 옆에 아이콘 넣고 오른쪽 여백에 DM팔로워, 팔로잉 한 사람들이랑 대화가능한
>   다이렉트메세지 기능 넣자. 쪽지기능은 커뮤니티 한정이야. 커뮤니티는 무조건 익명이니까
>   커뮤니티 탭 안에서만 따로 작동하는 쪽지 시스템을 만들어야해." / "1. 글에 케밥메뉴 달고
>   쪽지 보내는 기능 넣어. 글단위로 하자. 2. 대화를 글마다 따로 두자. 3. 비밀게시판에도 쪽지
>   허용하자. 글에 달린 댓글에도 케밥 메뉴 넣고 글에 있는 댓글유저한테도 보낼 수 있게 하고"
> - **승인 옵션**: DM 자격 = 팔로잉 ∪ 팔로워(**한쪽만 걸쳐도 가능**, 맞팔 불필요) / 쪽지 대상 =
>   글 **및 댓글** 작성자 / 대화는 **대상 단위로 분리**(같은 사람의 다른 글과 연결 금지) /
>   비밀게시판 허용 / **차단 기능 필수**(익명 메시지 괴롭힘 방지) / 확인은 폴링(실시간 아님).
> - **⚠️익명성 설계 — 정책이 아니라 구조로 막았다**(다음 세션이 되돌리지 말 것):
>   ① **메시지 문서에 uid를 아예 저장하지 않는다** — `from_role: "sender"|"recipient"`만.
>      직렬화 실수로도 샐 수 없게 만든 것이 요점이다.
>   ② **응답 스키마(`schemas/community_notes.py`)에 uid/표시명/아바타 필드 자체가 없다** —
>      "조건부 숨김"이 아니라 부재라 채울 자리가 없다.
>   ③ 스레드 문서에만 `sender_uid`/`recipient_uid`가 있고(라우팅·소유권·차단 판정용),
>      직렬화 경로는 `api/community_notes.py`의 `_to_thread_out`/`_to_message_out` **단 둘뿐**.
>   ④ 라벨은 `community_note_counters/{targetId}`의 트랜잭션 순번(1,2,3…)이고 **대상 범위
>      안에서만** 유효, uid 역산 불가, **받는 쪽에만** 내려간다(보낸 쪽 화면엔 senderLabel 없음).
>   ⑤ `api/notifications.py`가 **type=="note" 알림의 actor를 전부 잘라낸다**(actorUid·actor 키
>      자체 제거 + 프로필 배치 조회 대상에서도 제외). dm 알림은 실명 관계라 actor를 그대로 내린다.
> - **커밋**: 알림 계층(메인 스레드 직접 — NotificationType에 dm/note 추가, `actor_uid`를
>   optional로 바꾸고 note 분기 추가) → `9a3a92b`(DM: `follow_repo.list_followers_ids` 신규,
>   `dm_threads/{정렬된 uid쌍}` + `/messages` 서브컬렉션, 트랜잭션 전송·안읽음, 자격 403,
>   자기 자신 400, firestore.indexes.json에 array-contains+orderBy 복합 인덱스 추가) →
>   `a2361d6`(쪽지: `community_notes` + 카운터 컬렉션, 글·댓글 대상, 차단(받는 쪽만),
>   **댓글 대상이면 postId 필수** — 댓글이 `community_posts/{postId}/comments/{id}` 경로라
>   부모 id 없이는 collection-group 쿼리+인덱스가 필요해 그쪽을 피한 설계) →
>   `5d6126c`(`GET /api/dm/partners` — 새 대화 시작용 상대 목록, 이름 오름차순, `hasThread`,
>   표시 상한 100).
> - **⚠️테스트 픽스처 함정 재발**: `test_notifications_api.py`의 `authed_as`만 인증 게이트
>   작업 때 누락돼 **테스트 7개가 깨진 채 방치**돼 있었다(알림 유발 행동이 전부 게이트 뒤라
>   403). `yonsei_verified=True` 기본으로 고쳐 8개 통과. **새 API 테스트를 만들 때마다 이
>   함정을 확인할 것.**
> - **알려진 제약(사용자에게 옵션으로 보고함)**: 쪽지 차단에 **해제 API가 없다** — 실수로
>   차단하면 영구다. 필요해지면 `POST /{threadId}/unblock`을 받는 쪽 한정으로 추가.
> - **데모 자산(백업 포함)**: 쪽지 스레드 2개(**글 대상 1 + 댓글 대상 1**, 검증 중 차단됐던
>   것은 Firestore 직접 수정으로 해제) + DM 스레드 1개(demo-analyst ↔ 상대). 육안 확인용.
> - **프론트(피어)**: `31608a1`(쪽지 api·쪽지함·케밥) `8f6362e`(DM api·패널·우상단 아이콘,
>   1440px↑ 오른쪽 가장자리 384px 도킹 — `w-rail` 196px로는 대화 UI가 성립 안 함)
>   `668c481`(셸 배선: **커뮤니티=쪽지 / 그 외=DM** 배타 전환, 알림 벨 right-4 · 메시지
>   right-20). 남은 프론트: 알림함 dm/note 처리, DM 새 대화 시작 UI(둘 다 DmPanel.tsx 겹쳐 순차).

> **20차 (8/30) — 3단 접근 모델 마감: CORS 함정, 학과 배지 지속, 미인증 로컬 캔버스**:
> - **⚠️최대 교훈 — CORS `expose_headers` (`de518aa`)**: 19차에서 만든 403+`X-Auth-Requirement`
>   계약이 **실브라우저에서 전혀 동작하지 않았다.** 브라우저 `fetch()`는 CORS safelist 밖의
>   응답 헤더를 서버가 `Access-Control-Expose-Headers`로 명시해야만 읽을 수 있는데 main.py에
>   그 설정이 없었다. **curl/urllib에서는 헤더가 그대로 보여 서버 측 스모크로는 절대 안 잡힌다**
>   (실제로 내 스모크는 통과했고 프론트 세션이 브라우저 관점에서 잡았다). `allow_headers=["*"]`는
>   **요청** 헤더 허용이라 응답 노출과 무관 — 가장 헷갈리는 지점. 앞으로 **커스텀 응답 헤더로
>   계약을 만들 때는 반드시 expose_headers에 추가하고 브라우저에서 검증**할 것.
>   실검증 방법(비밀번호 자동화 없이 가능): 에뮬레이터에서 대상 계정 토큰을 발급받아
>   **페이지 컨텍스트(localhost:3000)의 fetch()** 로 호출 → `res.headers.get()` 확인.
>   실측 결과 읽을 수 있는 헤더가 `[content-length, content-type, x-auth-requirement]`.
> - **학과 배지 지속 `4792fe4`**: 프론트가 학과별 bin을 "추천 수업" 하나로 병합하며 원본 bin
>   라벨을 아이템 배지로 쓰던 것이 **저장 후 소실**됐다(화면 전용 값). 근본 원인은 더 깊었다 —
>   `MergedCourse.department`가 `CourseOption`까지는 갔는데 **출력 뷰 `ClusteredCourseView`에
>   필드가 없어 거기서 버려지고 있었다.** 즉 bin 아이템은 구조적으로 학과 맹인이었다.
>   수정: ClusteredCourseView + `BinItem.department` + `BinItemIn/Out`(각 **마지막 필드**,
>   기본 None) + `bin_suggestion._course_item`에 `if course.department:` 가드로 주입.
>   프론트 DTO는 `610c0f0`(constellation-api.ts는 이 세션 소유), 배지 소스 교체는 `1907dc9`
>   (**department 우선 → 없으면 bin.label 폴백** — 구 문서엔 키가 없어 폴백 필수).
>   - ⚠️역호환 검증법: **Firestore는 중첩 배열 요소 안의 필드를 dot-path로 못 지운다** →
>     문서를 통째로 읽어 파이썬에서 키를 제거하고 재 `set()` 해야 진짜 구 문서가 된다.
>     이걸 안 하면 "테스트는 통과하는데 실제 저장분이 깨지는" 사각이 생긴다.
> - **프론트 마감(피어)**: `cbe8b6c`+`b06bbc4`(ApiError에 authRequirement, 쓰기 액션 선제 차단 —
>   서버 가기 전 인증 안내. 헤더는 stale 토큰용 최후 방어선) `a27c905`(/demo, 8000 요청 0건
>   실측) `6df173f`(피드 댓글 아이콘화 + 뷰어 돌아가기 버튼) `f9dcab3`·`d1a8d84`(과목 검색 UI +
>   군집 병합 — **학과명 하드코딩 없이** `items.every(id.startsWith("course:"))` 구조 판정)
>   `95e4612`(**미인증 로컬 캔버스**: boot 3분기(익명/미인증-로컬/인증-서버),
>   **`enqueueMutation` 단일 초크포인트 게이트**로 어떤 호출부에서도 서버 쓰기가 안 새게 이중
>   방어, localStorage uid별 키·버전·디바운스 500ms·손상시 폐기, 인증 후 1회 "저장할까요?"
>   승계 모달, 저장 라벨 "브라우저에만 저장됨").
> - **알려진 미결(의도적 방치)**: 캔버스 다이브인의 `inferPrereqs`는 인테이크 게이트 대상이라
>   미인증이면 403 → 기존 catch가 console.warn만 하고 넘어간다. 선수관계 자동 연결이 안 될 뿐
>   화면은 정상이라 별도 처리 안 함(양 세션 합의).
> - **기술부채**: 과목 검색 응답 `level`은 원시 1~4인데 LLM 경로는 ×1000 스케일이라 프론트가
>   변환을 하나 들고 있다. 정리한다면 "백엔드는 항상 원시 1~4, ×1000은 캔버스 레이아웃
>   계층에서만" 방향. 지금 통일하면 LLM 경로 계약이 깨진다.
> - **일정(todos) 게이트 없음 = 현행 유지**(사용자 반대 없으면 확정). 논거: "상호작용 차단"은
>   사회적 행위(글·댓글·좋아요·팔로우) 목록이고 일정은 개인 도구 — `PATCH /me`를 연 것과 같은
>   성격. 막으면 인증 전까지 앱이 비어 이탈 요인.
> - **데모 자산(백업 포함)**: test-observer(인증) / `[데모] 데이터 분석러` demo-analyst(인증,
>   uid TQv2z5j…gTBI) / **demo-unverified@example.com(uid SckO25z9…auof, yonseiVerified false —
>   비-yonsei 도메인이라 자동 인증 안 됨, 미인증 화면 확인용)**. 셋 다 같은 비밀번호.
> - **사용자 육안 확인 대기 6건**(로그인 필요 화면이라 자동 검증 불가 — 양 세션 모두 비밀번호
>   입력 자동화 미수행): ①추천 사이드바 실데이터+팔로우 유지 ②알림함 목록·뱃지 ③미인증 계정
>   캔버스 로컬 저장·유지·차단 안내 ④인증 후 승계 모달 ⑤과목 검색 추가+학과 배지 ⑥랜딩 강제
>   로그인→/demo.

> **19차 (8/30) — 3단 접근 모델(비로그인/미인증/인증) + 과목 검색 API + explore 팔로우 상태**:
> - **사용자 지시 원문**: "랜딩페이지에서 무조건 로그인을 하게 만들고, 기존에 비로그인에서
>   둘러볼 수만 있던 상태를 미인증상태로 옮기자. (...) \"둘러보기\"를 누르면 둘러보기창을
>   따로 만들어서 별자리 잇기랑 탐색, 소셜기능을 데모로 (...) 실제로 백엔드 연결하거나 그럴필요
>   없이" / "미인증상태에서는 캔버스만 열어놔. API 대화도 꺼놓고. Publishing도 못하게 해.
>   그냥 요소 추가해서 혼자 가지고 놀 수만 있게 하자. 저장은 못하게 하고" / "기존에 인증한
>   유저들이 별자리 만들기 눌렀을떄 바로 LLM이 나오면 안돼. 기존에 만들던 별자리가 이어서
>   나와야지" / (과목 검색) "학정번호와 캠퍼스, 수업이름 검색필터로 스스로 검색해서 수업을
>   띄웠으면" + "수업군집을 하나 기본으로 넣어놓고 거기에 사용자가 검색해서 추가" /
>   (캠퍼스) "나중에 내가 적재해줄게 지금 캠퍼스 정보는 패스하자".
> - **3단 모델**: 비로그인=실화면 불가(랜딩→로그인), 대신 `/demo` 로컬 데모 / 로그인+미인증=
>   **읽기 O, 모든 쓰기 X** / 인증=전부. 미인증 캔버스는 localStorage 지속 → 인증 시
>   "저장할까요?" 승격(프론트 정책, 사용자 확정).
> - **⚠️핵심 발견**: `require_yonsei_verified`는 **이미 `app/auth/deps.py`에 있었다**(DecodedToken
>   기반 + 클레임 신선도 폴백: 토큰 claim이 False여도 Firebase 실시간 재조회 → 방금 인증한
>   유저가 토큰 갱신 전 1시간 막히는 문제 기해결). 구 API(roadmap/goals/beans)에만 걸려
>   있었을 뿐 새 계열이 무방비였던 것 — 새로 만들지 말고 의존성만 갈아끼우면 된다.
> - **`461c04f`**: 미인증 403에 헤더 `X-Auth-Requirement: yonsei-verified` 추가. **403이
>   소유권 위반에도 이미 쓰이므로** 프론트가 "인증 유도"와 "권한 없음"을 구분하려면 이 헤더가
>   필요하다. detail은 문자열 유지(ApiError가 문자열 전제). 3분기: 401=로그인 / 403+헤더=인증
>   / 403 무헤더=권한 없음. **프론트는 detail 문자열 매칭 금지.**
> - **게이트 적용** `bd35e39`(posts 생성·좋아요·댓글, stories 생성) `e2fdf37`(community 쓰기
>   6종, profiles follow/unfollow) `4c85a84`(constellation **쓰기 19개 전부** — 생성·삭제·
>   publish·bins PUT·노드/간선/그룹/노트 전 조작) `66c22f0`(intake **5개 전부** — chat·prereqs·
>   bins·bins/fill·**jobs 폴링**, 익명 허용(uid="anon") 완전 폐기).
>   - **의도적 비게이트**: profiles `PATCH /me`(미인증도 이름·이모지 설정 가능해야 유도 화면에서
>     안 갇힌다), 자기 콘텐츠 DELETE(posts/comments/stories — 미인증은 만들 수도 없어 지울 것도
>     없고, 인증 소실 시 정리 권한은 남기는 게 낫다), 모든 GET.
>   - **GET 계약 전부 불변** — 발행 별자리 익명 200(865193a)은 회귀 테스트로 고정, 재시작 후
>     라이브 실측 200 확인.
> - **⚠️테스트 함정(다음에도 반복될 것)**: 각 테스트 파일 `authed_as`가 만드는
>   `DecodedToken(uid=...)`의 **`yonsei_verified` 기본값이 False**라, 게이트를 걸면 기존 쓰기
>   테스트가 전부 403으로 깨진다. → `authed_as` 내부에서 `yonsei_verified=True`로 고정(시그니처
>   유지), 미인증 케이스는 dependency_overrides 직접 세팅. `get_live_yonsei_verified`는
>   테스트 환경 실측 결과 없는 uid도 깔끔히 False(콜드 ~2.2s, 웜 ~6ms) — monkeypatch 불필요.
> - **과목 검색 `4db6fca`**: `GET /api/courses/search?q=&department=&college=&limit=`(q는
>   **과목명 부분일치 OR 학정번호 접두/부분 겸용**, limit 기본 20·**상한 30 클램프**(422 아님),
>   필터 전무면 기본 상위 목록, **로그인만 — 미인증 200**) + `GET /api/courses/taxonomy`
>   (실데이터 학과 159·단과대 34). 검색 전략: department/college 있으면 Firestore로 좁힌 뒤
>   파이썬 필터(스캔 1000) / q가 학정번호꼴이면 `code` 범위 쿼리 / 그 외 상한 2000 fetch 후
>   부분일치. **⚠️실데이터 학과명은 `철학과`가 아니라 `철학전공` 형태** — 드롭다운은 반드시
>   taxonomy 값을 쓸 것. **campus는 이음새만**: 스키마·MergedCourse에 optional 선언, 항상
>   None(exclude_none으로 키 생략). 사용자가 직접 적재 예정이므로 **ETL·재적재 건드리지 말 것**.
> - **explore 팔로우 상태 `eaf9bb0`**(사용자 실사용 발견 버그): 추천/검색 응답에 isFollowing이
>   없어 프론트가 로컬 state로만 버튼을 토글 → 새로고침하면 원복됐다(서버 저장 자체는 정상).
>   `ExploreUserOut.is_following: bool | None` 추가(익명·본인은 키 생략), `/users` 추천에서
>   **이미 팔로우한 유저 제외**(`/search`는 노출 유지 + 라벨만). 요청당 `list_following_ids`
>   1회로 제외·라벨링 동시 처리. **⚠️함정: `list_following_ids` 기본 상한 100** — 그대로 쓰면
>   팔로잉 101번째부터 isFollowing이 거짓 False가 된다. explore는 10,000 명시.
> - **프론트(피어)**: `fc8b862`(진입 시 최신 별자리 이어서 열기 — 발행만 해둔 계정이 매번 LLM
>   대화를 보던 실사용 버그) `a8d34d6`(isFollowing 배선) `a27c905`(/demo 데모 모드, 8000 요청
>   0건 실측) `6df173f`(피드 댓글 아이콘화 + 별자리 뷰어 돌아가기 버튼 — 좌상단은 로고와 겹쳐
>   우상단). 랜딩 강제 로그인·미인증 프론트 게이트는 사용자 화면 확인 후 착수 예정.

> **18차 (8/30) — 제품 정체성 전환: "전체 공개 SNS" 제거 → 로그인 게이트 + 팔로우 기반 피드**:
> - **사용자 지시 원문**: "연세대라는 폐쇄된 인적네트워크 상에서 작동하는 서비스라 SNS를
>   빼는게 나을것같아. 소셜 탭은 놔둘거야. 탐색에서 찾은 익명의 같은 관심사를 가진 사람들끼리
>   팔로우하면 그 사람들끼리의 게시물, 스토리, 로드맵을 볼 수 있게" / "로그인 하지 않은
>   상태에서 탐색창, 커뮤니티창, 일정, 소셜창 다 들어갈 수 있게 하자. 대신 뭐 클릭하려고 하면
>   로그인창 띄우게 하고" / "미팔로우인 사람에게 (...) 같은 관심사의 사람들의 게시물도 띄워보자.
>   처음에는 누구나 팔로워가 없으니까 (...) 나중에는 팔로워 위주로" / "별모양으로 알림함 기능도
>   만들자" / "알림함에 새 로드맵 발행 알림은 넣지마. 넣으면 사람들 안쓴다".
> - **⚠️설계 반전 기록(중요)**: 최초 승인안은 "게시물=팔로워만 403"이었고 b56538e로 구현까지
>   갔으나, 사용자가 콜드스타트 문제("처음엔 누구나 팔로워가 없으니 아무것도 안 뜬다")를
>   제기해 **옵션1=로그인만 게이트(익명 401), 팔로우는 차단이 아니라 피드 구성 기준**으로
>   전환. b56538e는 44816d4가 대체(superseded). 앞으로 이 결정을 되돌리지 말 것.
> - **최종 계약**: posts user/{uid}·{post_id}·images·feed, stories user/{uid} = 익명 401 /
>   로그인이면 팔로우 무관 200. stories ring = 기존 팔로우 구성 유지. **별자리 발행=비로그인
>   포함 공개는 불변**(17차 865193a 계약 유지, 회귀 테스트로 고정).
> - **커밋**: `44816d4`(게시물 로그인 게이트, can_view 헬퍼 폐기) → `d3c93d8`(피드 3단
>   콜드스타트: 응답 래퍼 `{source:"following"|"interest"|"latest", posts:[...]}`, 팔로잉 0명이면
>   관심사 겹침 유저 글, 그것도 없으면 전체 최신. **Firestore `in` 상한 30 실측 확인** —
>   31이면 InvalidArgument, `_FEED_QUERY_IN_CHUNK=30`) → `2e6a237`(스토리 로그인 게이트) →
>   `f963dbf`(죽은 constellation feed 엔드포인트+FeedItemDto 삭제, 소비자 0건 기확인) →
>   `4970fe0`(알림함: notifications 컬렉션, follow/like/comment 3종만, 자기행위 제외, 훅은
>   fail-open) → `8466bd1`(탐색 검색: `@`=닉네임 유사, 키워드=이름·bio·태그 매칭 + 뷰어
>   관심사 겹침 순 정렬, 유저 fetch 상한 500) → `e4ad8d6`(explore 자기제외 회귀 테스트 —
>   코드는 이미 정상이었고 프론트가 관측한 혼입은 편집 중 과도 상태) → `aad994a`(알림에
>   actor 프로필 동봉, `db.get_all()` 배치 조회. ⚠️함정: follow가 카운트만 올린 **필드 없는
>   users stub**이 존재해 첫 구현이 깨졌음 — exclude_none 처리 필수).
> - **프론트(피어 03-code-26)**: `5c9a64e`(비로그인 4탭 진입+/login?next= 게이트) `50b6a63`
>   (비로그인 프로필 그리드) `245b3b3`(피드 재작성+source 배너+비슷한사람 사이드바)
>   `ee8310d`(상세 401 게이트) `a6ccc43`(PIPA: 팔로우 관계·관심사 태그 = 자동 생성 개인정보
>   명시). 알림함 UI는 **상단 헤더 바가 없어 우상단 고정 버튼**으로 확정(/constellation 제외).
> - **데모 자산(백업 포함)**: 2번째 계정 `[데모] 데이터 분석러`(uid TQv2z5j…gTBI,
>   demo-analyst@yonsei.ac.kr) + 발행 별자리 `5c710edb…` + 게시물 1건. test-observer와
>   관심사 부분 겹침(경영통계·ADsP)으로 랭킹·콜드스타트 검증 가능. **피드 source 3단 전이
>   실측 완료**: 팔로우0=interest → 팔로우=following → 언팔=interest 복귀. 백업은 언팔로우
>   상태로 보존.
> - **미검증(사용자 육안 확인 항목)**: ①소셜 우측 추천 사이드바 실데이터 렌더 ②알림함 로그인
>   상태 UI. 둘 다 로그인 필요 화면이고 **비밀번호 입력 자동화는 양 세션 운영 규칙상 미수행** —
>   스키마 정합 대조+목 렌더까지만 검증됨.

> **17차 (8/30) — 익명 단건 열람 회귀 복원 + 프론트 4건(피어) 랜드, 원격 첫 푸시**:
> - **회귀 `865193a`**: GET /api/constellations/{cid} 단건만 하드 인증(get_current_user)이라
>   발행 별자리 익명 열람이 401 — 공유 링크·게시물 상세 임베드 전멸(피어 실측 보고).
>   가시성 판단(_get_owned_or_published)은 이미 "소유자 또는 발행"이므로 의존성만
>   get_current_user_optional로 완화(uid=None 허용). /feed·/user/{uid}와 동일 계약.
>   회귀 테스트 2개 추가(익명 발행=200/익명 미발행=403). ⚠️함정: 이 스위트 authed_as
>   픽스처가 get_current_user만 override라 optional 라우트가 테스트에서 익명으로 보여
>   8개 오탐 — 둘 다 override로 수정(test_community_api 패턴). 52 전부 통과.
>   ⚠️이 회귀는 오늘 재시작 전 옛 프로세스가 옛 코드를 서빙해 잠복했던 것(Windows
>   uvicorn 수동 재시작 필수 교훈 재확인). 서버 재시작+익명 실측 200 확인.
> - **프론트 4건(피어 03-code-03) `cf03107`**: ①시안 다이브인 픽셀 밀림(별점을 좌표에
>   정확 앵커, 라벨 아래 absolute — 간선 px attribute 유지) ②스파게티(신규
>   lib/layered-order.ts barycenter 층내 정렬을 시안+캔버스 다이브인 양쪽 적용, 추이적
>   중복 간선 그리기 생략(시안 한정, prereqIds 데이터 불변), 밀집층 지그재그)
>   ③진입 배율 하한 ENTRY_MIN_ZOOM=0.65(computeFitTransform minZoom 인자, 부트+
>   fitRequest만) ④다이브인 상한 DIVE_FIT_MAX_ZOOM 1.8→1.15. 배율 체감 조정은 이 두
>   노브 상수만 만지면 됨. 성운 미리보기 모션 불변 유지.
> - **feature/constellation 원격 첫 푸시**(사용자 지시 "이거다 하고나서 git push하자").
> - 피어가 검증용 데모 성단 group:demo-verify(멤버 4)를 데모 별자리에 추가 —
>   emulator-backup 재갱신에 포함.

> **16차 (8/30) — "과목 실종" 근본 확진 + 4중 방어 완성, 사용자 지적 4건 전부 랜드**:
> - **과목 실종 확진(데이터는 무사, 소실 아님)**: ①course_repo `list_taxonomy` 프로세스 캐시가
>   에뮬레이터 빈 시점 첫 호출의 **빈 목록을 영구 캐시** → 이후 전 잡이 조용히 수업 0개
>   ②침묵 실패 3지점 무경고 ③파싱 쓰레기 학과명(college 필드에 설명 문장, 실측
>   data/dept-check.txt) ④**tests/conftest.py autouse 픽스처가 매 테스트 후 에뮬레이터
>   프로젝트 전체 삭제** — 에뮬레이터 켠 채 pytest 돌릴 때마다 7,109과목 전멸(실사고,
>   e76bdad 에이전트가 발견·즉시 재적재).
> - **4중 방어**: ⓐ자가치유 `e76bdad`(학과<3이면 미캐시+재스캔·경고, 쓰레기 학과명 필터
>   — 실데이터 기준 college 19개 정확 제거·학과 159 전부 생존, 침묵 2지점 WARNING, "직접
>   전공 없으면 인접·기반 학과" 프롬프트 원칙, 테스트 22통과) ⓑ원클릭 복구
>   `backend/scripts/restore_emulator.ps1` `46fe76e`(-Backup=export, 기본=courses-2026.json
>   재적재, 없으면 Downloads TXT 재파싱) ⓒ현 상태 data/emulator-backup export 완료 —
>   에뮬레이터는 `firebase emulators:start --import=data/emulator-backup
>   --export-on-exit=data/emulator-backup`로 기동 권장 ⓓ**pytest 격리 `8418993`**:
>   conftest가 FIRESTORE_PROJECT_ID를 `demo-ourlab-test`로 강제 대입(setdefault 아님) —
>   셸에 demo-ourlab export한 적대 조건에서 22테스트 완주 후 실데이터 7,109 생존 실증.
>   **Blaze 결제 불필요**(로컬은 import/export로 충분, Storage 영상 업로드만 별개).
> - **사용자 지적 4건 랜드**: ①인테이크 "선택 완료" 항상 가시 `8828df7`(입력창 위 고정 바,
>   375px 칩 3줄 wrap에서도 좌표 실측 통과, 스크롤 useEffect 의존성 보강) ②튜토리얼 별 극소
>   `1d9b2ed`(근본=flex-1 높이 collapse 828×150px + computeFitTransform의 768px↑ 가짜 우측
>   패널 분기 → aspect-[1440/900]+max-w-[640px]로 k=1 복원, 더블클릭·간선 잇기 실측)
>   ③다이브인 성단 칩 파국 `5d25781`(근본=칩 필터 `g.id===diveGroupId` 잔존 → X=그룹 해제
>   → 격리 필터가 전부 숨김·복귀 불능. 수정=다이브인 중 칩 전면 숨김+그룹 소멸 시 자동
>   diveOut 가드+우하단 칩 z-30·truncate. 파국 재현→자동 복구 실증) ④백엔드=ⓐ.
> - **백엔드 재시작 완료**(taxonomy 캐시=프로세스 캐시라 필수): /prereqs 실 LLM 스모크 정상
>   (BIZ1101→BIZ2110). ⚠️/health `db:error` — Docker Desktop 꺼져 있어 구 Postgres down
>   (영향=일정 todos만, 필요 시 Docker 기동).
> - **피어 협업 규칙 신설(사용자 지시, 메모리 저장)**: "프론트엔드 세션에 위임할 수 있는건
>   위임해. 컨텍스트랑 내가 말한 본문도 반드시 같이 전달하고." → 위임 시 컨텍스트+지시
>   원문 verbatim+파일 소유권 경계 동봉 의무. 실행: 피드 상세(피어가 잔여 범위 승인 진행 —
>   Post.constellationId 계약 변경 시 이쪽 api/스키마 조정 예정), 구 test-observer uid 시드
>   갱신(피어 grep 결과 리포 0건 — no-op 종결).
> - 남은 확인: 로그인 QA 첫 저장 422 회귀 / 실 LLM 재완주 체감(경영류 주제로 과목 포함 확인)
>   / 파서 근본 수정(college 문장 유입, app/etl) 백로그.

> **15차 (8/30) — 캔버스 다이브인 완성판 + 인테이크 UX + 튜토리얼 맞춤** (사용자 지시 5건 반영):
> - **캔버스 온디맨드 위계+격리+배율 `0953747`**: onDiveInGroup 콜백 → page.tsx가 다이브인
>   순간 /prereqs 호출·간선 자동 생성(그룹당 1회, 수업 노드<2 또는 내부 간선 존재 시 스킵 —
>   page.tsx 1337·1344행 가드). 같은 커밋에 **격리**(diveMemberIds로 노드 1431/간선 1236/
>   성운 안개 1613/GroupChip 1753 렌더 필터)와 **배율 정상화**(computeDiveLayout 층형·원형
>   자동 재배치, DIVE_MIN_SPACING=90, DIVE_FIT_MAX_ZOOM=1.8; 편집=영속, readOnly=
>   diveLayoutOverride 임시)까지 포함. 별도 에이전트가 실측 완주: 3·16멤버 라벨 겹침 0건,
>   외부 요소 완전 숨김, 복귀 픽셀 단위 원상복구, 콘솔 무오류.
>   ⚠️운영 교훈: 이 에이전트는 커밋 후 체크인 2회 무응답으로 강제 중단됐는데 작업은 끝나
>   있었다 — **중단 전 git log/status 확인이 재위임 낭비를 막는다**(재위임 에이전트는 검증만 함).
> - **인테이크 칩 `480c5f7`**: 복수선택 토글+"선택 완료"(", " 조합 한 메시지, 실 LLM 왕복
>   실측) + "기타(직접 입력)" 칩(입력창 포커스·placeholder 전환, 칩+타이핑 조합 전송, 라벨
>   미전송). 질문 전환 시 선택 리셋. 근거: "복수선택 가능하게 수정해" + "'기타' 칸 두고 직접
>   타이핑".
> - **튜토리얼 `ebae632`**: 다이얼로그 max-h-[92vh]+flex column, 캔버스 슬라이드 flex-1,
>   스크린샷 슬라이드 aspect-[1440/900] 고정 박스(라벨 정렬 유지). 1280×720·800에서 전
>   슬라이드 무스크롤 실측. 피어 feed.png 교체(`e9bf662` — 데모 게시물 2건 시드, 구
>   test-observer uid 변경됨: 시드 스크립트가 구 uid 참조 시 갱신 필요)에 맞춰 소셜 슬라이드
>   라벨 좌표 교정 포함.
> - 세션 한도 끊김 → SendMessage 재개로 3에이전트 전원 복구(유실 없음). 앞으로 장기
>   에이전트는 "중간 커밋 자주" 지시 포함.
> - 남은 확인(변동 없음): 로그인 QA 첫 저장 422 회귀 / 실 LLM 1완주 체감 / 익명 로컬 상태가
>   챗 닫기 후 잔존 노드로 누적되는 UX(테스트 중 발견 — 버그는 아니나 거슬리면 다음 항목).

> **14차 (8/30) — 선수과목 위계(온디맨드 대원칙) + 성운 마감** (사용자 지시 3건:
> "선수과목 순으로 위계가 한눈에 들어오도록 노드가 연결" / "과목마다 미리 이어놓는다기보다는
> 대원칙을 세워놓고 api가 그때그때 적용" + "핵심적인건 이어놔도 좋지만 일반화된 규칙 필요" /
> "메인캔버스에서 확대 애니메이션 + 'ㅇㅇㅇ성운' 우하단 + 성운 안 별자리 잇기, 시안 모션 불변"):
> - **아키텍처**: 잡 시점 선계산이 아니라 **일반 대원칙을 시스템 프롬프트에 명문화**(레벨
>   오름차순·전공기초→필수→선택·개론/원론→심화/실무 명칭·확신 없으면 안 이음, 학과 하드코딩
>   없음)하고 `POST /api/constellation-intake/prereqs`가 **그때그때 적용**(익명 허용,
>   rate limit 30/min). 프론트는 시안 다이브인 순간 1회 lazy 호출→`BinItem.prereqIds`
>   (string[], 같은 bin 안 선수 항목 id) 캐시→저장 시 영속. ⚠️Opus 검증이 잡은 원계획 결함:
>   `[[from,to]]` 중첩 배열은 **Firestore가 거부**(배열 안 배열 금지) — 항목별 prereqIds로 설계.
> - **백엔드 `92d36d7`**: LLMClient.infer_prerequisites(base/anthropic/mock — mock=레벨 인접
>   결선), _PREREQ_SCHEMA(쌍은 문자열 배열 아닌 {before,after} object — required가 길이 검증
>   대체), 멤버십 검증+_drop_cycles(그리디 DAG), max_tokens 4000·thinking off,
>   BinItemIn/Out `prereq_ids`(**기본 None 필수 — []면 exclude_none이 못 거름**, 마지막 필드
>   선언 — validator 순서 의존). 테스트 84통과. 실스모크: 경영학입문→마케팅원론 정확.
> - **프론트 `094d929`**(스테이지): interiorLayoutFor(items,seed,viewport) — rank=prereqIds
>   최장경로(순환 안전·dangling 무시), 폴백=level(1000단위→층), 지원요소=기존 포스 폴백.
>   간선 SVG는 px attribute만(CSS transform 금지 함정), 스프링 좌표 추적. 진입 모션·입자 불변.
> - **프론트 `4815b0f`**(materialize): 매퍼 prereqIds 통과(유실 방지 — Opus가 잡은 치명 누락),
>   prereqEdgesFor(같은 bin+존재 노드만 — dangling이면 첫 저장 422 전멸 방어), 확정 시 레벨
>   층형 배치(rowGap×rows≤500px 클램프), "모두 추가"/bin 통째 드롭 경로도 간선 생성.
>   ⚠️함정 2건: handleEdgeCreate 선언 순서 TDZ, **placeItem 직후 nodesRef는 미갱신**(ref는
>   커밋 후 useEffect) → 존재 검사를 bin.items로.
> - **캔버스 UX `2675abf`**: 상단 배너=복귀 버튼만, 우하단 "{라벨} 성운" 표시 칩(우측 패널·
>   띄우기 버튼과 겹침 실측 회피 bottom-20 right-4 md:right-[324px]). **성운 안 간선 잇기는
>   이미 정상**(멤버=일반 노드, 기존 캡처 방어 유효 — 실 포인터 검증만 필요했음).
> - **캔버스 성운 비주얼 `c481ab3`**: 접힌 성단=시안과 같은 안개+입자(buildNebulaParticles/
>   hashSeed를 DraftReviewStage에서 export 공유, 시드=group.id — Record라 인덱스 금지),
>   radialGradient 1개+currentColor 트릭. ⚠️**git 사고 전례: 평범한 커밋이 타 에이전트 스테이지
>   분까지 쓸어담음 → 모든 에이전트 `git commit -- <pathspec>` 스코프 커밋 의무화.**
> - **미검증 잔여**: ①첫 저장 422 회귀(로그인 필요라 익명 실측 불가 — 코드 검사만. 로그인 QA
>   때 제목 확정 통과 확인) ②스테이지 다이브인 실통합(실 LLM 대화 필요 — 실 LLM 1완주 때 확인)
>   ③캐시 없는 bin은 캔버스 다이브인 시점 lazy 적용 미구현(다음 후보).

> **13차 (8/29 밤) — 성운 다이브인(제자리 전개 → 진입형 편집으로 교체)** (사용자 지시:
> "성운 하나 클릭하면 그 성운 속으로 들어가는(확대되는) 애니메이션으로 해서 해당 성운 안에서
> 요소들 편집"):
> - **시안 스테이지(`716afc9`)**: DraftReviewStage 다이브인 재작성 — 성단 클릭 시 단일 래퍼
>   transform(translate+scale, DIVE_ZOOM_K=16, 450ms cubic-bezier(.22,1,.36,1),
>   transformOrigin=클릭 성단 %)으로 성운 속 진입 → 내부 뷰(성운 안개+큰 별+라벨·학정번호·
>   유형 점, 스태거 45ms 등장) → "← 성운 밖으로" 필/Esc(내부에서만)로 복귀.
>   12차의 포스 전개(c5adde1 제자리 팝)는 이걸로 대체됨.
> - **⚠️클릭 강탈 근본 원인(사용자 3회 질책 건)**: 조상 팬 레이어가 모든 pointerdown에
>   setPointerCapture → 중첩 button의 네이티브 클릭이 죽음(hit-test 정상·합성 click은 동작·실
>   포인터만 무시로 3중 검증). 수정 = 히트 타깃에서 stopPropagation+자기 capture+5px 이동
>   임계값. **교훈: 팬 캔버스 위 클릭 요소는 반드시 이 패턴 + 실 포인터로 검증**(합성 이벤트
>   검증은 이 버그를 통과시킴 — c5adde1가 임시 라우트만 검증해 놓친 전례).
> - **메인 캔버스(`1dad460`)**: ConstellationCanvas 성단 클릭(클릭 분기·readOnly·Enter/Space
>   공통)→computeFitTransform 목표로 rAF 줌인(450ms easeOutQuint)+도착 후 전개, 상단 배너
>   "← 성운 밖으로 · {이름}"/Esc(다이브 중에만 리스너 등록 — 타 Esc 소비자와 충돌 없음 확인)/
>   현재 성단 GroupChip 접기 버튼도 diveOut으로 → preDiveTransform 복원. 수동 팬/휠 시 rAF
>   취소. readOnly 뷰어는 기존 로컬 groupOverrides 경로 재사용(서버 호출 0). 실 포인터 왕복
>   실측 완료(진입→멤버 더블클릭 완료 토글→복귀, 콘솔 무오류).
> - **튜토리얼 캔버스(피어 `4567a47`)**: 가이드 1장 플레이그라운드를 실 ConstellationCanvas
>   임베드로 교체(사용자: "UI 대충 만들지 말고 메인페이지 캔버스랑 똑같이" 반영).
> - **테스트 시 BGM 음소거 규칙(사용자 지시)**: 자동화 주행 전 대상 origin에
>   `localStorage["ourlab-bgm-muted"]="1"` 선주입, 프리뷰 탭은 쓰고 바로 닫기.
> - 함정: dev 서버 장수 시 HMR 유령 크래시(previewBoxRef ReferenceError — 소스에 없음)는
>   서버 재시작+새 탭으로만 소거. 남은 확인: 실 LLM 1완주 체감(12차와 동일).

> **12차 (8/29 저녁) — 성운 질감·물리 전개 + 대기창 2단 분리** (사용자 실사용 피드백 2건):
> - **대기창 분리(피어 4667ca4)**: 기본=정중앙 로더+"사용법 익히기" 버튼만(캐러셀 미렌더)
>   → 클릭 시 대형 다이얼로그(max-w-4xl)로 캐러셀 이동, Esc/X 복귀, 주석 라벨은
>   pointer-events-none+지시선 텍스트로(버튼 오인 제거).
> - **성운 개선(`c5adde1`)**: ①성단 원 안에 시드 입자(FNV-1a+mulberry32, ≤40개/성단,
>   균일 원반 분포, 유형 혼합 색, starTwinkle 재사용) ②클릭 전개=**내용물 열람**: 멤버가
>   라벨·학정번호·유형 점과 함께 튀어나옴 — 자체 경량 포스(척력 1400/최소 30px/중심 스프링
>   k=0.02, 120회 완화)+rAF 스프링 팝(강성 210·감쇠 26, ~1s 정착, 유휴 rAF 없음) ③줌 소폭
>   확대(패딩 0.06·클램프 5~95·지름 상한 84). splitCourseCode를 ElementBinPanel에서 export해
>   공유. 수치 실측: 20멤버 최소 간격 29.6px, 최대 반경 77px.
> - 함정: **숨겨진 브라우저 탭은 rAF 스로틀** — 애니메이션 실측은 좌표·상태 검증으로 대체
>   (visibilityState 확인). API 연결 끊김 2회에도 에이전트 재개(SendMessage)로 유실 없이 완주.
> - 라벨 충돌 회피(지시선 시스템)는 의도적 생략 — 실데이터에서 겹침 잦으면 다음 항목.
> - 남은 확인: 실 LLM 1완주로 대기창→성운(입자·전개)→확정 전체 체감 확인(사용자 직접 or ≈$1).

> **11차 (8/29 오후) — 시안 성운화(full-load) + 대기창 로더·가이드** (피어 03-code-03 협업):
> - **시안 계약 전면 교체** `c368bb5`: drafts는 더 이상 항목 발췌가 없다 — 모든 bins가 성단으로
>   전부 표시되는 전제에서 안별 차이는 {coreBinLabels(핵심 2~4, bins label 그대로),
>   binEdges(성단 간 경로 label 쌍)}. itemIds/edges 제거, 라벨 검증(core 0이면 폐기),
>   접미 별칭 로직 삭제(라벨 기반이라 불필요). mock도 동일 계약(라벨 MECE 분할).
> - **프론트** `1086145`+`dffd28b`: 스테이지가 bins 전체를 성단(멤버 수 배지·core lit 강조·
>   binEdges 경로)으로 렌더 — 좌표는 binClusterCenter 황금각(스테이지·캔버스 공유). 확정 시
>   **bins 전 항목+성단을 로컬로만 materialize**(서버 호출 0 — 첫 저장 때 일괄 업로드),
>   binEdges는 군집 대표 노드 간선으로(접힘 렌더가 성단↔성단 선으로 승격).
> - **대기창(피어)** `df3dbbb`+`20ee89d`: 시드 미니 별자리 로더(불이 노드로 옮겨감, 간선
>   드로우온) + 사용법 캐러셀 5장(점 인디케이터, 1장=인터랙티브 더블클릭·간선잇기
>   플레이그라운드, 2~5장=frontend/public/guide/ 스크린샷+코드 오버레이 — feed.png는 빈
>   상태라 교체 후보) + **폴링 상한 120→400회(10분)** — 실 LLM 잡 3~5분이라 180s는 정상
>   생성 중 만료였음.
> - **버그 2건 실측·수정**: ①binClusterCenter 선형 반경(220+130i)이 17군집에서 ±2300px로
>   퍼져 fit 붕괴 → √(필로택시스) 반경으로(`ae48e73`에 포함) ②**성단 원점 붕괴**: 성단 g에
>   위치 attribute와 sprout CSS 애니메이션이 같은 요소 — SVG에서 CSS transform이 attribute
>   transform을 통째로 덮어씀(fill-mode:both라 영구). 위치 g/애니메이션 g 2중 분리(`ae48e73`).
>   ⚠️교훈: **SVG에서 transform 애니메이션은 반드시 위치 래퍼와 분리** — 노드 spikeBreathe는
>   원래 분리돼 있었음(올바른 패턴). + HMR 낡은 번들 크래시 오탐 1건(재현 전 fresh reload 필수).
> - 검증: mock 완주 — 성운 스테이지(성단 17·요소 408 전부 표시) → 확정 → 캔버스 17성단
>   분산 렌더(좌표 실측). 실 LLM 완주는 1회 유실(HMR) 후 미재실행 — **다음 확인 항목**:
>   실 LLM로 대기창→성운 시안→확정 1회 완주(≈$1), 캐러셀 소뷰포트, feed.png 실 게시물 교체.

> **10차 (8/29) — 실 LLM 전환 + 과목 무제한 로드 + 성단(그룹 노드)** (전부 이 세션 단독 —
> 프론트 피어 부재. 실키 identity-linked라 `ANTHROPIC_WORKSPACE_ID` 헤더 필요 → `c451e68`):
> - **환경 사고·복구**: 에뮬레이터 전멸(메모리 저장소) → 실과목 재적재 누락 실수 → Downloads
>   요람 TXT 2개로 parse_courses→load_courses **7,109과목 복원**. 재발 방지:
>   `firebase emulators:export data/emulator-backup`(5.1MB) 백업. ⚠️시드 작성 시 컬렉션별
>   타임스탬프 관례(users=datetime / 나머지=epoch-ms int) — int를 users에 넣으면 explore 500.
> - **실 LLM 스모크 + 결함 수정 3연타**: ①지원요소 max_tokens 2000 잘림→4000(`0db9900`)
>   ②**학과 선택 taxonomy 접지**: 실제 학과/단과대 목록(list_taxonomy, 프로세스 캐시)을
>   프롬프트에 주입 + fetch_limit 100→400 + 군집 프롬프트 "빠짐없이, 상한 없음" +
>   cluster max_tokens 20000(`ffbc4f2`) ③**drafts 전멸 원인**: 항목 116개 규모에서 모델이
>   `course:CODE` 대신 CODE만 반환→환각 방어 전멸. 접미 별칭 역매핑+전멸 시 warning
>   (`dcdf2c9`). 실측: "데이터사이언티스트"→13군집 116항목(응통 25과목 통째)+시안 3안,
>   "패션 MD"→의류환경학과(CNT) 9군집+패션 3안 — **분야 일반화 검증 완료**(키워드 하드코딩 없음).
> - **성단(그룹)**: 백엔드 `3af40c2` — Constellation.groups dict{id,label≤60,memberNodeIds,
>   collapsed,position}, POST/PATCH/DELETE /{cid}/groups(소유 트랜잭션, 멤버 존재 필터,
>   응답=ConstellationOut, 구 문서 역호환). 프론트 `0853b2d`+`529f1cb`+`88469ec` —
>   접힘=성단 노드(log 스케일 발광 원+멤버 수 배지+라벨, 간선 대표연결·dedupe), 클릭/Enter
>   전개(sprout), GroupChip(라벨 에딧·해제·접기), 드래그 이동, **모두 추가→자동 성단**(3개
>   미만 생략), 뷰어는 로컬 토글만(타인 문서 PATCH 금지), MiniConstellation 정적 성단.
>   실측: 모두 추가 12과목→캔버스 성단 1개(배지 12)→Enter 전개 노드 6→17→접기 칩 왕복 복원.
> - 폴링 누수 재보고는 라인 감사 결과 4분기 모두 clearInterval 존재 — 코드 결함 아님 판정
>   (관측은 완료 전 정상 폴링으로 추정). 재현 시 재조사.
> - 프론트 인계 5차의 "새 백엔드 테스트 격리 대기"는 8/28 격리 런 55/55로 해소됨. 성단
>   테스트는 작성만 — **다음 격리 런에 test_constellation_api.py 포함할 것**.
> - 다음 후보: 성단 캡처 포함 임페커블 검수(이번 배치 미검수 — 스크린샷만 확보), 성단
>   내부 간선 시각화 정책, drafts가 성단 힌트 반환(군집→그룹 자동 매핑), 실 LLM 비용
>   최적화(캐시 검증), 프론트 인계 문서 갱신(피어 부재로 이 세션이 프론트 커밋 4개 수행).

> **9차 (심야2) — 탐색(Explore) 신설 + 소셜의 SNS 피드 전환** (두 세션 공동. 사용자 배경:
> "소셜 탭 존재이유가 유명무실 — 관심사를 직접 축적할 수 있는 우리 강점으로 사람을 찾게 하자".
> 재량 승인: 모바일 탭 5슬롯=탐색·소셜·생성FAB·커뮤니티·프로필, **일정은 모바일 탭 제외**):
> - **백엔드** `254e6e9`: ①**interest_tags 축적** — 발행/비공개 전환 시점에
>   발행 별자리 전체의 노드 라벨 빈도 상위 5를 순수 함수(compute_interest_tags, 동률=최근
>   갱신 우선)로 계산해 users 문서 비정규화(발행 0이면 빈 리스트, 트랜잭션 밖 느슨한 일관성)
>   ②`GET /api/explore/users`(≤30, 정렬 단일 키 (-교집합,-updatedAt) — 익명은 교집합 0이라
>   자연 최신순, 본인·이름 없는 유저 제외, commonTags는 로그인 시만 키 존재) ·
>   `GET /api/explore/search?q=`(display_name prefix 관용구, 1~30자, ≤20)
>   ③`GET /api/posts/feed`(작성자 조인 {post, author} 중첩 — FeedItemOut 관례, /user/{uid}보다
>   먼저 선언). 격리 런 **55/55**(explore 스위트 포함) + compute_interest_tags 단위 27케이스.
> - **프론트(피어 03-code-ae=구 03-code-c7 연속)**: `6eab37b` 네비(돋보기 SearchIcon,
>   TAB_ORDER=[explore,feed,new,community,mine]) + /explore(디바운스 검색·seq 역전 방지,
>   aspect-[3/4] 초상형 카드 그리드, commonTags lit 칩) · `854e5be` /feed SNS 전환(별자리
>   스트림 제거→스토리 링+게시물 스트림+동영상 준비 중 자리, 캐러셀·별 좋아요 재사용,
>   댓글은 카운트+퍼머링크로 N+1 회피) · `cdae459` 계약 정렬 · `034bad0` 검수 5건(카드
>   이름 shrink-0+칩 slice(0,4)+"+N", 캐러셀 스와이프+44px 히트, 좋아요/공유 44px,
>   한글 자간 분리, FIELD NOTE 제거→"게시물 N개").
> - **검수 4차**: 백엔드 0건, 정본 정합 클린. 모바일 카드 이름 소실의 근본 원인
>   (truncate span만 flex-shrink로 0 압축) 규명 포함.
> - **함정 추가**: ①시드 스크립트가 users 문서에 epoch-ms int를 넣으면 user_repo의
>   datetime 관례와 충돌해 explore 정렬에서 500 — **컬렉션별 타임스탬프 관례 확인 후 시드**
>   (users=datetime, constellation/community/stories=epoch-ms int) ②한글 포함 파일에
>   PowerShell 텍스트 치환 금지(cp949로 주석 전파 — 피어 실사고, Edit 도구로만)
>   ③피어 세션 재기동 시 이름이 바뀜(03-code-19→ae) — ListAgents로 재확인 후 위임 재전달.
> - **사용자 QA 목록(로그인 필요) 추가분**: 탐색에서 겹치는 관심사 유저 카드의 lit 칩 확인,
>   발행 시 interest_tags 실제 축적(발행 후 탐색에 본인 노출).
> - 다음 후보: 영상 업로드(Storage/Blaze 후 — 피드·프로필·스토리에 이음새 있음), 탐색
>   페이지네이션·태그 필터, 검색 디바운스 서버 측 제한, 피드 팔로잉 필터 탭.

> **8차 (심야) — 커뮤니티/SNS 2층위: 익명 게시판 6종 + 스토리 24h** (두 세션 공동, 사용자 결정:
> 영상은 Storage/Blaze 활성화 후 별도 배치 · 스토리=인스타식 24h · 게시판 자유/비밀/질문/정보/진로/홍보):
> - **백엔드(이 세션)**: `27977e3`+`15d810b` 커뮤니티 — BOARDS 코드 상수(6종, secret만
>   forcedAnonymous), community_posts+comments+likes(카운트 트랜잭션), **익명 직렬화 단일 지점**
>   `_to_post_out`/`_to_comment_out`(익명이면 author 키 자체 부재, isMine으로 "익명(나)"),
>   secret은 글·댓글 모두 서버 강제 익명, 열람 익명 허용·작성 인증(글 10/분·댓글 20/분).
>   상세 응답은 `{post, comments}` 중첩·like는 POST/DELETE 분리(응답=갱신 글 전체) ·
>   `f96fb04` 스토리 — POST(imageData, posts 검증 공유)/GET user/{uid}(활성만)/GET ring
>   (팔로잉≤50+본인, hasUnseen은 limit-1 단순화 주석)/view(익명 no-op)/DELETE. 만료는 쿼리
>   필터만(크론 없음) · `71e8844` 검수 반영(assert→404).
> - **격리 테스트 런 확립**: 공유 에뮬레이터(8080)는 사용자 라이브 데이터 보존을 위해
>   **pytest 금지**(프론트 5차 규칙 채택). 스크래치패드에 firebase.json(포트 8090)+run-tests.ps1
>   두고 `firebase emulators:exec --project demo-ourlab-isolated`로 일괄 실행 — **39/39 통과**.
>   그 과정에서 테스트 결함 2건 수정(`88fd6e7`): authed_as가 get_current_user_optional
>   미오버라이드(isMine 항상 False), 스토리 만료 테스트가 고정 미래 시각 사용.
>   ⚠️ 인라인 명령 중첩 인용은 `$env:`가 깨져 가짜 성공 — 반드시 -File 스크립트로.
> - **프론트(피어 03-code-19)**: `beae545`+`af7bc51` 커뮤니티 3라우트+네비/탭 5슬롯 ·
>   `22ac89b` 스토리(링·뷰어·업로드 시트, 영상=준비중 비활성) · `bb3be46` 타인 프로필 스토리
>   링(이쪽 QA 발견 버그: 링이 인증 전용 ring 엔드포인트에만 배선돼 있었음) · `6c6b360` 검수
>   반영(한글 mono 분리, lit 세 번째 용처=스토리 링 명문화+DESIGN.md 커뮤니티/스토리 절 신설,
>   뷰어 포커스 트랩+화살표 키, 비익명 폴백 "관측자").
> - **검수(임페커블, 캡처 기반)**: 익명성 무누수·비밀 게시판·잉크/종이 픽셀 규율 클린 판정.
>   keep: `_to_*_out` 단일 스트리핑 지점 우회 금지. 캡처는 .impeccable/review/에 5종
>   (desktop/mobile=게시판, 글 상세, 스토리 링/뷰어).
> - **데모 시드**: 캡처용으로 공유 에뮬레이터에 추가만 — uid=demo-user-1("데모 관측자"🔭),
>   [데모] 글 3(자유2·비밀1)+댓글4+스토리2. 사용자가 지워도 무방.
> - **사용자 QA 목록(로그인 필요)**: ①글쓰기 폼(일반=익명 기본+실명 체크 / 비밀=체크박스 없음
>   — 익명은 /login 리다이렉트라 캡처 불가) ②스토리 업로드 시트(사진/스토리/영상-준비중)
>   ③본인 링 갱신·view 후 hasUnseen 변화 ④커뮤니티 글·댓글·좋아요 실작성.
> - 다음 후보: **영상 업로드(Storage/Blaze 활성화 후)**, 에타식 익명 넘버링(익명1·2),
>   게시판 카드 최신 글 미리보기, ring per-viewer seen 정밀화, 신고/관리 기능(PIPA:
>   익명 글도 author_uid 서버 기록 — 처리방침 항목 추가 필요).

> **7차 (저녁) — 신기능 4건: 섬 크롬 + Edit 색 모드 + 프로필 인스타화 + 띄우기/뷰어 (+팔로우 Firestore 이관)**
> 두 세션 공동(백엔드=03-code-a0, 프론트=03-code-19, SendMessage 조정). 사용자 원칙 추가:
> **"판단은 효율이 아니라 효과성"** — 팔로우 이관을 미루지 않고 이번에 포함(옵션 1 추천을 지적받음).
> - **백엔드**: `a8fa8ab` Node.color(#RRGGBB 검증)+발행 메타(PublishPatchIn: title/description/
>   contributors ≤10×40자, 생략=유지·[]=비움)+`GET /constellations/user/{uid}`(발행물, 익명,
>   복합 인덱스 firestore.indexes.json 추가 — **배포 시 인덱스 반영 필요**) · `6765735` 팔로우
>   이관: `/api/profiles` prefix(GET {uid}·PATCH me·POST/DELETE {uid}/follow, isFollowing은
>   로그인+타인일 때만 키 존재), follows/{follower}_{followee}+카운트 비정규화. **레거시
>   /api/users는 일정 전용으로 축소(살아있음), 구 팔로우/bio 데이터는 폐기 확정**.
> - **프론트(이 세션)**: `86ed1eb` 섬 크롬 — 몰입형에서 SideRail 제거, 좌상단 로고+Yonsei
>   Community, 좌하단 서랍→NavIsland(islandExpand 220ms), 패널 접기, 종이 paper-soft/95 톤다운,
>   툴바 상단 중앙 · `165496f` F1 API 클라이언트 · `a544ffe`+`b768ccc` Edit 모드(onNodeActivate/
>   suppressInfoCard prop, ColorPaletteBar 7색=기존 토큰 hex, 낙관적+patchNodeColor 큐, 미저장은
>   생성 경로 color 관통)+LaunchModal(블러+섬 창, Contributor 칩, 비로그인 안내, **발행 행위를
>   모달로 일원화** — 툴바 발행 토글 제거) · `f903f2e` 사문 삭제 · `8b9eb46` 검수 반영(모바일
>   서랍 숨김, 스와치 잉크 링, 팔레트 열림 시 모바일 CTA 숨김, alert→발행 칩 glow-bloom 2.6s,
>   인증 전 칩 paper 대비, readOnly aria-pressed 생략, **DESIGN.md 모달 이원화 명문화**: 섬 모달
>   =paper/관측 모달=ink — 사용자 원문 "섬 스타일 창"이 근거).
> - **프론트(피어 위임)**: `ff18afa` node.color 폴백 5곳 일원화 · `15b6657` 뷰어
>   /constellation/{cid}(readOnly, 노트 UI 미포함 — 공개 노트 정책 미정) · `7a520f2` readOnly
>   인터랙션(클릭→정보 카드 허용, activateNode TDZ로 위치 이동) · `a3b54e4` 프로필 인스타
>   그리드 · `025d068` profiles-api.ts+팔로우 실배선+뷰어 작성자(profiles 조회, 404→"알 수 없는
>   관측자") · `fc1964a` 뷰어 카드 모바일 클램프 · `ab1cac0` gitignore.
> - **QA 실측(익명 범위, Playwright)**: 섬 크롬·네비 섬·편집⇄완성·팔레트(#FFA76B fill 검증)·
>   스와치 링·띄우기 모달 로그인 안내·/feed 익명 200 전부 정상. **사용자 로그인 QA 목록**:
>   ①프로필 인스타 그리드+팔로우 왕복 ②띄우기 모달 필드 입력→발행→프로필/피드/뷰어 노출
>   ③뷰어 모바일 375px 정보 카드 ④기존 별자리 배지 ⑤발행 glow 모멘트.
> - 함정 추가: 합성 pointerdown 디스패치는 setPointerCapture에서 죽음(실 클릭으로 테스트) ·
>   next build가 tsconfig.json 재포맷(커밋 금지) · 서브에이전트가 남긴 전체 pytest 고아가
>   에뮬레이터를 계속 초기화(발견 즉시 kill) · 피어 빌드는 .next-build(한 번 .next 오염 사고).
> - 다음 후보: 공개 노트 뷰어 노출 정책, Contributor uid 연계+사용자 검색, 계정 삭제 Firebase
>   이관(DangerZone 구 의존), firestore.indexes.json 배포, 실 LLM 스모크.

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
