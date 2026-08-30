"""탐색(Explore) API - 공통 관심사 유저 추천 + 표시 이름 검색 (prefix /api/explore).

## 관심사 태그는 여기서 계산하지 않는다

users.interest_tags는 별자리 발행 시점에 비정규화되는 캐시 필드다(계산 규칙은
app/domain/constellation.py의 compute_interest_tags, 갱신 지점은
app/api/constellation.py의 publish 핸들러 참고). 이 라우터는 그 캐시를 읽고
"요청자 태그와 얼마나 겹치는가"만 계산한다 - 태그 자체를 다시 집계하지 않는다.

## 정렬은 API 계층의 책임

user_repo의 조회 함수(list_users_with_interest_tags/list_all_users)는 후보
목록만 돌려주고, "요청자와 얼마나 겹치는가"에 따른 정렬은 요청자
컨텍스트(로그인 여부, 본인 태그)가 있어야 가능하므로 이 라우터가 담당한다
(app/api/profiles.py가 is_following 판단을 API 계층에 두는 것과 동일한 층 분리).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from google.cloud.firestore import Client

from app.auth.deps import get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.firestore import follow_repo, user_repo
from app.firestore.client import get_firestore_client
from app.schemas.explore import ExploreUserOut

router = APIRouter(prefix="/api/explore", tags=["explore"])

_LIST_LIMIT = 30
_SEARCH_LIMIT = 20
# user_repo.list_all_users의 상한 - 그 함수 docstring 참고(ponytail: 유저 수백 명
# 규모까지는 이 상한 안에서 전체 스캔이 감당된다).
_SEARCH_SCAN_LIMIT = 500
# follow_repo.list_following_ids 호출 시 명시적으로 줄 상한. 기본값(100)이나
# 피드가 쓰는 50 같은 작은 값을 그대로 쓰면, 팔로잉이 그 수를 넘는 유저는 상한
# 밖의 팔로이가 isFollowing=False로 잘못 표시되는 정확성 버그가 된다. 여기서는
# 이 집합 하나로 추천 제외 + isFollowing 판정을 모두 하므로 전량이 필요하다
# (ponytail: 유저 수만 명 규모가 되면 페이지네이션으로 승격할 것).
_FOLLOWING_SCAN_LIMIT = 10_000


def _to_out(
    uid: str,
    profile: dict[str, Any],
    *,
    requester_tags: set[str] | None,
    is_following: bool | None,
) -> ExploreUserOut:
    tags: list[str] = profile.get("interest_tags") or []
    common_tags = None if requester_tags is None else [t for t in tags if t in requester_tags]
    return ExploreUserOut(
        uid=uid,
        display_name=profile.get("display_name"),
        avatar_emoji=profile.get("avatar_emoji"),
        bio=profile.get("bio"),
        interest_tags=tags,
        common_tags=common_tags,
        is_following=is_following,
    )


def _sort_key(profile: dict[str, Any], *, requester_tags: set[str]) -> tuple[int, float]:
    """(음수 교집합 크기, 음수 updated_at 타임스탬프) - 둘 다 오름차순 정렬하면 원하는
    내림차순(교집합 큰 순 -> 최근 갱신 순)이 된다. requester_tags가 빈 집합이면
    (익명 요청) 교집합 항은 항상 0이라 자연스럽게 updated_at 내림차순 하나로
    수렴한다 - 로그인/익명을 분기하지 않고 한 정렬 키로 두 요구사항을 만족시킨다.
    """
    overlap = len(requester_tags & set(profile.get("interest_tags") or []))
    updated_at = profile.get("updated_at")
    ts = updated_at.timestamp() if updated_at else 0.0
    return (-overlap, -ts)


def _requester_tags(db: Client, user: DecodedToken | None) -> set[str] | None:
    """로그인 요청자면 본인 관심사 태그 집합을, 익명이면 None을 반환한다."""
    if user is None:
        return None
    profile = user_repo.get_user_profile(db, user.uid)
    return set((profile or {}).get("interest_tags") or [])


def _requester_following_ids(db: Client, user: DecodedToken | None) -> set[str]:
    """로그인 요청자가 팔로우 중인 uid 집합을 반환한다(익명이면 빈 집합).

    이 집합 하나를 ①추천(/users) 목록에서 이미 팔로우한 유저 제외 ②추천/검색
    응답의 isFollowing 판정에 함께 쓴다 - 항목마다 follow_repo.is_following을
    개별 호출하면 후보 수만큼 쿼리가 늘어나므로 한 번만 읽는다.
    """
    if user is None:
        return set()
    return set(follow_repo.list_following_ids(db, user.uid, limit=_FOLLOWING_SCAN_LIMIT))


def list_uids_with_shared_interest(
    db: Client, uid: str, requester_tags: set[str], limit: int
) -> list[str]:
    """uid와 관심사(interest_tags)가 하나 이상 겹치는 유저의 uid를 겹침 큰 순으로 최대 limit명 반환한다.

    app/api/posts.py의 피드 콜드스타트 분기(팔로잉이 0명일 때 관심사로 보충)가
    재사용한다 - list_explore_users와 달리 겹침이 0인 후보는 아예 제외한다(탐색
    페이지는 "추천"이라 겹침 0도 보여주지만, 피드는 무관한 남의 글을 섞지 않는다).
    """
    if not requester_tags:
        return []
    candidates = [
        (candidate_uid, profile)
        for candidate_uid, profile in user_repo.list_users_with_interest_tags(db)
        if candidate_uid != uid and set(profile.get("interest_tags") or []) & requester_tags
    ]
    candidates.sort(key=lambda item: _sort_key(item[1], requester_tags=requester_tags))
    return [candidate_uid for candidate_uid, _ in candidates[:limit]]


def _display_name_sort_key(profile: dict[str, Any]) -> str:
    """2순위(폴백) 후보의 정렬 키 - 표시 이름 오름차순.

    2순위는 요청자 관심사와 무관하게 채우는 후보라 겹침 크기로 정렬할 근거가
    없다. updated_at처럼 계속 변하는 값 대신 표시 이름을 쓰면, 같은 후보 집합에
    대해 매 요청 결과 순서가 안정적으로 유지된다.
    """
    return profile.get("display_name") or ""


@router.get("/users", response_model=list[ExploreUserOut], response_model_exclude_none=True)
async def list_explore_users(
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> list[ExploreUserOut]:
    """비슷한 사람 추천을 최대 30명, 가능하면 항상 채워서 반환한다.

    1순위: 관심사(interest_tags)가 하나라도 있는 유저 중 요청자 본인과 이미
    팔로우 중인 유저를 제외한 나머지 - 요청자의 interest_tags와 교집합 크기가
    큰 순, 동률(익명 포함)이면 최근 갱신순(updated_at 내림차순)이다(기존 동작
    그대로).

    2순위(폴백): 1순위만으로 상한(30명)을 못 채우면, 관심사 유무·겹침과
    무관하게 나머지 유저(1순위에 없고, 본인도 팔로우 중도 아닌)로 채운다 -
    실사용 계정이 적어 1순위 후보가 바닥나도(예: 3명뿐인 상태에서 하나를
    팔로우하면 1순위가 0명이 되는 상황) 추천 사이드바가 통째로 비지 않게 하기
    위함이다. 2순위 항목은 정의상 interest_tags가 비어 있거나 교집합이 없어
    commonTags가 빈 배열([])이거나(로그인 시) 아예 키가 없다(익명 시) - 별도
    필드를 추가하지 않고 기존 스키마 안에서 "추천 근거 없음"을 표현한다.

    두 순위 모두 요청자 본인/이미 팔로우 중인 유저는 제외한다. 정렬은
    1순위(교집합 큰 순) 뒤에 2순위(표시 이름 순)를 이어붙인 순서다.
    """
    requester_tags = _requester_tags(db, user)
    following_ids = _requester_following_ids(db, user)

    def _excluded(uid: str) -> bool:
        return (user is not None and uid == user.uid) or uid in following_ids

    primary = [
        (uid, profile)
        for uid, profile in user_repo.list_users_with_interest_tags(db)
        if profile.get("display_name") and not _excluded(uid)
    ]
    primary.sort(key=lambda item: _sort_key(item[1], requester_tags=requester_tags or set()))
    selected = primary[:_LIST_LIMIT]

    if len(selected) < _LIST_LIMIT:
        primary_uids = {uid for uid, _ in selected}
        fallback = [
            (uid, profile)
            for uid, profile in user_repo.list_all_users(db, limit=_SEARCH_SCAN_LIMIT)
            if profile.get("display_name") and not _excluded(uid) and uid not in primary_uids
        ]
        fallback.sort(key=lambda item: _display_name_sort_key(item[1]))
        selected = selected + fallback[: _LIST_LIMIT - len(selected)]

    return [
        _to_out(
            uid,
            profile,
            requester_tags=requester_tags,
            is_following=(uid in following_ids) if user is not None else None,
        )
        for uid, profile in selected
    ]


def _keyword_match_count(profile: dict[str, Any], query_lower: str) -> int:
    """검색어가 프로필의 몇 군데(표시 이름/소개/관심사 태그 각각)에 걸리는지 센다.

    익명 요청(뷰어 관심사를 모름)일 때 정렬 기준으로 쓴다 - 뷰어 관심사와 겹치는
    수를 잴 수 없으니, 대신 "이 검색어 자체와 얼마나 관련 있어 보이는가"로 대체한다.
    """
    tags = profile.get("interest_tags") or []
    count = sum(1 for tag in tags if query_lower in tag.lower())
    if query_lower in (profile.get("display_name") or "").lower():
        count += 1
    if query_lower in (profile.get("bio") or "").lower():
        count += 1
    return count


def _matches_keyword(profile: dict[str, Any], query_lower: str) -> bool:
    """표시 이름·소개·관심사 태그 중 하나라도 검색어를 부분일치로 포함하는가."""
    return _keyword_match_count(profile, query_lower) > 0


@router.get("/search", response_model=list[ExploreUserOut], response_model_exclude_none=True)
async def search_explore_users(
    q: str = Query(min_length=1, max_length=30),
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> list[ExploreUserOut]:
    """`@`로 시작하면 닉네임(표시 이름) 부분일치 검색, 아니면 표시 이름·소개·관심사
    태그 부분일치 키워드 검색이다(사용자 원문: "탐색창에서는 사용자가 키워드검색을
    하면 사용자의 인적사항과 유사하고, 유사한 관심사를 가진 타유저를 띄우고, @표시
    붙여서 아이디를 검색하면 비슷한 닉네임의 유저를 띄우기"). q는 1~30자(빈 값은
    422), 익명 열람 허용(get_current_user_optional). 요청자 본인은 결과에서 제외한다.

    정렬: 로그인 상태면 요청자의 interest_tags와 겹치는 수 내림차순, 익명이면
    검색어 자체와의 매칭 수(_keyword_match_count) 내림차순이다.

    Firestore는 부분일치 쿼리를 지원하지 않으므로 user_repo.list_all_users로 후보
    집합(최대 _SEARCH_SCAN_LIMIT명)을 통째로 가져와 파이썬에서 필터링한다(그
    함수 docstring의 ponytail 참고 - 상한을 넘는 유저 규모가 되면 검색 인덱스로
    승격할 것).
    """
    requester_tags = _requester_tags(db, user)
    following_ids = _requester_following_ids(db, user)
    viewer_uid = user.uid if user is not None else None
    candidates = [
        (uid, profile)
        for uid, profile in user_repo.list_all_users(db, limit=_SEARCH_SCAN_LIMIT)
        if uid != viewer_uid
    ]

    if q.startswith("@"):
        nickname_query = q[1:].strip().lower()
        matches = [
            (uid, profile)
            for uid, profile in candidates
            if nickname_query and nickname_query in (profile.get("display_name") or "").lower()
        ]
    else:
        query_lower = q.lower()
        matches = [
            (uid, profile) for uid, profile in candidates if _matches_keyword(profile, query_lower)
        ]

    if requester_tags is not None:
        matches.sort(
            key=lambda item: -len(requester_tags & set(item[1].get("interest_tags") or []))
        )
    else:
        query_for_ranking = q[1:].strip().lower() if q.startswith("@") else q.lower()
        matches.sort(key=lambda item: -_keyword_match_count(item[1], query_for_ranking))

    return [
        _to_out(
            uid,
            profile,
            requester_tags=requester_tags,
            is_following=(uid in following_ids) if user is not None else None,
        )
        for uid, profile in matches[:_SEARCH_LIMIT]
    ]
