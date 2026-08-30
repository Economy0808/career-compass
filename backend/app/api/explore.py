"""탐색(Explore) API - 공통 관심사 유저 추천 + 표시 이름 검색 (prefix /api/explore).

## 관심사 태그는 여기서 계산하지 않는다

users.interest_tags는 별자리 발행 시점에 비정규화되는 캐시 필드다(계산 규칙은
app/domain/constellation.py의 compute_interest_tags, 갱신 지점은
app/api/constellation.py의 publish 핸들러 참고). 이 라우터는 그 캐시를 읽고
"요청자 태그와 얼마나 겹치는가"만 계산한다 - 태그 자체를 다시 집계하지 않는다.

## 정렬은 API 계층의 책임

user_repo의 조회 함수(list_users_with_interest_tags/search_by_display_name_prefix)는
후보 목록만 돌려주고, "요청자와 얼마나 겹치는가"에 따른 정렬은 요청자
컨텍스트(로그인 여부, 본인 태그)가 있어야 가능하므로 이 라우터가 담당한다
(app/api/profiles.py가 is_following 판단을 API 계층에 두는 것과 동일한 층 분리).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from google.cloud.firestore import Client

from app.auth.deps import get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.firestore import user_repo
from app.firestore.client import get_firestore_client
from app.schemas.explore import ExploreUserOut

router = APIRouter(prefix="/api/explore", tags=["explore"])

_LIST_LIMIT = 30
_SEARCH_LIMIT = 20


def _to_out(
    uid: str, profile: dict[str, Any], *, requester_tags: set[str] | None
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


@router.get("/users", response_model=list[ExploreUserOut], response_model_exclude_none=True)
async def list_explore_users(
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> list[ExploreUserOut]:
    """공통 관심사가 있을 만한 유저를 최대 30명 추천한다. 요청자 본인은 제외한다.

    로그인 시 요청자의 interest_tags와 교집합 크기가 큰 순, 동률(익명 포함)이면
    최근 갱신순(updated_at 내림차순)이다.
    """
    requester_tags = _requester_tags(db, user)
    candidates = [
        (uid, profile)
        for uid, profile in user_repo.list_users_with_interest_tags(db)
        if profile.get("display_name") and (user is None or uid != user.uid)
    ]
    candidates.sort(key=lambda item: _sort_key(item[1], requester_tags=requester_tags or set()))
    return [
        _to_out(uid, profile, requester_tags=requester_tags)
        for uid, profile in candidates[:_LIST_LIMIT]
    ]


@router.get("/search", response_model=list[ExploreUserOut], response_model_exclude_none=True)
async def search_explore_users(
    q: str = Query(min_length=1, max_length=30),
    user: DecodedToken | None = Depends(get_current_user_optional),
    db: Client = Depends(get_firestore_client),
) -> list[ExploreUserOut]:
    """표시 이름 접두(prefix) 검색. q는 1~30자(빈 값은 422), 익명 열람 허용."""
    requester_tags = _requester_tags(db, user)
    results = user_repo.search_by_display_name_prefix(db, q, limit=_SEARCH_LIMIT)
    return [_to_out(uid, profile, requester_tags=requester_tags) for uid, profile in results]
