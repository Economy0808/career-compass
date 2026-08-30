"""/api/community/notes API 통합 테스트 - 실제 Firestore 에뮬레이터를 상대로 실행한다.

test_community_api.py와 동일한 이유로 Mock을 쓰지 않고, 인증은
app.dependency_overrides로 대체한다.

CRITICAL: 이 스위트는 작성만 하고 실행하지 않는다(공유 에뮬레이터 보호 - 작업 지시).
격리된 에뮬레이터에서의 일괄 실행은 별도로 진행한다.

실행 방법 (backend/ 에서, 이 세션이 아닌 별도 격리 에뮬레이터에서):
    firebase emulators:exec --only firestore --project demo-ourlab \
        ".venv/Scripts/python.exe -m pytest tests/test_community_notes_api.py -q"

## 이 스위트의 핵심: 익명성 회귀 테스트

test_no_identity_leak_across_full_note_flow가 이 기능의 가장 중요한 안전장치다 -
쪽지 관련 모든 응답 JSON을 재귀 탐색해 senderUid/authorUid/recipientUid/displayName/
avatarEmoji 같은 키가 어디에도 없는지, 그리고 실제 uid 문자열 값이 어디에도
새어나가지 않는지 검증한다.
"""

from __future__ import annotations

import os
from collections.abc import Callable, Iterator
from typing import Any

import pytest
import requests
from httpx import ASGITransport, AsyncClient

from app.auth.deps import get_current_user, get_current_user_optional
from app.auth.firebase_auth import DecodedToken
from app.main import app


def _emulator_available() -> bool:
    host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if not host:
        return False
    try:
        requests.get(f"http://{host}/", timeout=2)
    except requests.exceptions.RequestException:
        return False
    return True


pytestmark = pytest.mark.skipif(
    not _emulator_available(),
    reason=(
        "FIRESTORE_EMULATOR_HOST가 설정되지 않았거나 에뮬레이터가 응답하지 않음 - "
        "firebase emulators:exec --only firestore --project demo-ourlab 로 실행할 것"
    ),
)


@pytest.fixture(autouse=True)
def _clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


@pytest.fixture
def authed_as() -> Callable[[str], None]:
    """주어진 uid로 get_current_user/get_current_user_optional을 함께 override한다.

    require_yonsei_verified 게이트를 통과해야 하므로 yonsei_verified=True 기본값
    (test_community_api.py의 authed_as fixture와 동일한 함정 회피 - Working Principles).
    """

    def _set(uid: str) -> None:
        token = DecodedToken(uid=uid, yonsei_verified=True)
        app.dependency_overrides[get_current_user] = lambda: token
        app.dependency_overrides[get_current_user_optional] = lambda: token

    return _set


def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def _create_post(
    client: AsyncClient, *, board: str = "free", title: str = "제목", body: str = "내용"
) -> dict[str, Any]:
    resp = await client.post(
        f"/api/community/boards/{board}/posts", json={"title": title, "body": body}
    )
    assert resp.status_code == 201
    return resp.json()


async def _create_comment(
    client: AsyncClient, post_id: str, *, body: str = "댓글"
) -> dict[str, Any]:
    resp = await client.post(f"/api/community/posts/{post_id}/comments", json={"body": body})
    assert resp.status_code == 201
    return resp.json()


_FORBIDDEN_KEYS = {
    "senderUid",
    "recipientUid",
    "authorUid",
    "sender_uid",
    "recipient_uid",
    "author_uid",
    "displayName",
    "display_name",
    "avatarEmoji",
    "avatar_emoji",
    "uid",
}


def _assert_no_identity_leak(value: Any, forbidden_substrings: set[str]) -> None:
    """응답 JSON을 재귀 탐색해 금지된 키/uid 값이 어디에도 없는지 검증한다."""
    if isinstance(value, dict):
        for key, sub in value.items():
            assert key not in _FORBIDDEN_KEYS, f"금지된 키 노출: {key} (값={sub!r})"
            _assert_no_identity_leak(sub, forbidden_substrings)
    elif isinstance(value, list):
        for item in value:
            _assert_no_identity_leak(item, forbidden_substrings)
    elif isinstance(value, str):
        for needle in forbidden_substrings:
            assert needle not in value, f"uid 문자열 누출: {needle!r} in {value!r}"


# --- 익명성 회귀 테스트 (핵심 안전장치) ---


@pytest.mark.asyncio
async def test_no_identity_leak_across_full_note_flow(
    authed_as: Callable[[str], None],
) -> None:
    """글 작성 -> 쪽지 시작 -> 목록 -> 상세 -> 답장 -> 차단, 모든 응답에 신원 정보가 없어야 한다."""
    uids = {"author-leak", "sender-leak-1", "sender-leak-2"}

    authed_as("author-leak")
    async with _client() as client:
        post = await _create_post(client, title="누출 테스트 글")
    post_id = post["id"]

    responses: list[Any] = [post]

    authed_as("sender-leak-1")
    async with _client() as client:
        start_resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post_id, "body": "안녕하세요"},
        )
        assert start_resp.status_code == 201
        responses.append(start_resp.json())
        thread_id = start_resp.json()["id"]

        reply_resp = await client.post(
            f"/api/community/notes/{thread_id}/messages", json={"body": "추가 메시지"}
        )
        assert reply_resp.status_code == 201
        responses.append(reply_resp.json())

        inbox_resp = await client.get("/api/community/notes")
        assert inbox_resp.status_code == 200
        responses.append(inbox_resp.json())

        messages_resp = await client.get(f"/api/community/notes/{thread_id}/messages")
        assert messages_resp.status_code == 200
        responses.append(messages_resp.json())

    # 같은 대상에 두 번째 발신자가 등장해 라벨 부여 경로도 함께 검증한다.
    authed_as("sender-leak-2")
    async with _client() as client:
        second_start = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post_id, "body": "저도 궁금해요"},
        )
        assert second_start.status_code == 201
        responses.append(second_start.json())

    authed_as("author-leak")
    async with _client() as client:
        author_inbox = await client.get("/api/community/notes")
        assert author_inbox.status_code == 200
        responses.append(author_inbox.json())

        author_thread_id = start_resp.json()["id"]
        author_messages = await client.get(f"/api/community/notes/{author_thread_id}/messages")
        assert author_messages.status_code == 200
        responses.append(author_messages.json())

        block_resp = await client.post(f"/api/community/notes/{author_thread_id}/block")
        assert block_resp.status_code == 200
        responses.append(block_resp.json())

    for resp_json in responses:
        _assert_no_identity_leak(resp_json, uids)


# --- 기본 흐름 ---


@pytest.mark.asyncio
async def test_send_note_to_post_author_returns_200(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("post-author")
    async with _client() as client:
        post = await _create_post(client)

    authed_as("note-sender")
    async with _client() as client:
        resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "쪽지입니다"},
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["role"] == "sender"
    assert data["targetType"] == "post"
    assert data["postTitle"] == post["title"]


@pytest.mark.asyncio
async def test_send_note_to_comment_author_returns_200(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("post-author-2")
    async with _client() as client:
        post = await _create_post(client)

    authed_as("comment-author")
    async with _client() as client:
        comment = await _create_comment(client, post["id"])

    authed_as("note-sender-2")
    async with _client() as client:
        resp = await client.post(
            "/api/community/notes",
            json={
                "targetType": "comment",
                "targetId": comment["id"],
                "postId": post["id"],
                "body": "댓글 잘 봤어요",
            },
        )
    assert resp.status_code == 201
    assert resp.json()["targetType"] == "comment"
    assert resp.json()["commentExcerpt"] is not None


@pytest.mark.asyncio
async def test_comment_target_without_post_id_is_400(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("sender-missing-post-id")
    async with _client() as client:
        resp = await client.post(
            "/api/community/notes",
            json={"targetType": "comment", "targetId": "no-such-comment", "body": "본문"},
        )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_self_note_is_rejected(authed_as: Callable[[str], None]) -> None:
    authed_as("self-noter")
    async with _client() as client:
        post = await _create_post(client)
        resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "혼잣말"},
        )
    assert resp.status_code in (400, 403)


@pytest.mark.asyncio
async def test_secret_board_post_allows_note(authed_as: Callable[[str], None]) -> None:
    authed_as("secret-author")
    async with _client() as client:
        post = await _create_post(client, board="secret")

    authed_as("secret-note-sender")
    async with _client() as client:
        resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "비밀 게시판 쪽지"},
        )
    assert resp.status_code == 201


# --- 스레드 격리: 글마다 따로 ---


@pytest.mark.asyncio
async def test_same_sender_different_posts_get_separate_threads(
    authed_as: Callable[[str], None],
) -> None:
    """같은 사람이 쓴 서로 다른 글의 쪽지 스레드는 절대 연결되지 않는다."""
    authed_as("multi-post-author")
    async with _client() as client:
        post_1 = await _create_post(client, title="첫 번째 글")
        post_2 = await _create_post(client, title="두 번째 글")

    authed_as("repeat-sender")
    async with _client() as client:
        thread_1a = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post_1["id"], "body": "첫 쪽지"},
        )
        thread_1b = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post_1["id"], "body": "이어쓰기"},
        )
        thread_2 = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post_2["id"], "body": "다른 글 쪽지"},
        )
    assert thread_1a.json()["id"] == thread_1b.json()["id"]  # 같은 글 -> 이어붙임
    assert thread_1a.json()["id"] != thread_2.json()["id"]  # 다른 글 -> 별개 스레드


# --- 라벨 부여 ---


@pytest.mark.asyncio
async def test_two_senders_get_different_labels_visible_to_recipient(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("label-author")
    async with _client() as client:
        post = await _create_post(client)

    authed_as("label-sender-a")
    async with _client() as client:
        await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "A입니다"},
        )
    authed_as("label-sender-b")
    async with _client() as client:
        await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "B입니다"},
        )

    authed_as("label-author")
    async with _client() as client:
        inbox = await client.get("/api/community/notes")
    assert inbox.status_code == 200
    my_threads = [t for t in inbox.json()["threads"] if t["role"] == "recipient"]
    labels = {t["senderLabel"] for t in my_threads}
    assert len(labels) == 2  # 라벨이 서로 달라야 한다


# --- 차단 ---


@pytest.mark.asyncio
async def test_block_then_send_is_403_and_sender_cannot_block(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("block-author")
    async with _client() as client:
        post = await _create_post(client)

    authed_as("block-sender")
    async with _client() as client:
        start_resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "안녕하세요"},
        )
        thread_id = start_resp.json()["id"]
        sender_block_resp = await client.post(f"/api/community/notes/{thread_id}/block")
    assert sender_block_resp.status_code == 403  # 보낸 쪽은 차단 불가

    authed_as("block-author")
    async with _client() as client:
        block_resp = await client.post(f"/api/community/notes/{thread_id}/block")
    assert block_resp.status_code == 200
    assert block_resp.json()["blocked"] is True

    authed_as("block-sender")
    async with _client() as client:
        blocked_reply = await client.post(
            f"/api/community/notes/{thread_id}/messages", json={"body": "무시하지 마세요"}
        )
        blocked_restart = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "다시 시도"},
        )
    assert blocked_reply.status_code == 403
    assert blocked_restart.status_code == 403


@pytest.mark.asyncio
async def test_unblock_then_send_succeeds_again(authed_as: Callable[[str], None]) -> None:
    """차단 -> 해제 -> 다시 전송이 되는지가 이 기능의 핵심 계약이다."""
    authed_as("unblock-author")
    async with _client() as client:
        post = await _create_post(client)

    authed_as("unblock-sender")
    async with _client() as client:
        start_resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "안녕하세요"},
        )
        thread_id = start_resp.json()["id"]

    authed_as("unblock-author")
    async with _client() as client:
        block_resp = await client.post(f"/api/community/notes/{thread_id}/block")
        assert block_resp.status_code == 200

    # 보낸 쪽은 해제도 불가 (block과 동일 권한 규칙)
    authed_as("unblock-sender")
    async with _client() as client:
        sender_unblock_resp = await client.post(f"/api/community/notes/{thread_id}/unblock")
    assert sender_unblock_resp.status_code == 403

    # 제3자도 해제 불가
    authed_as("unblock-third-party")
    async with _client() as client:
        third_party_unblock_resp = await client.post(f"/api/community/notes/{thread_id}/unblock")
    assert third_party_unblock_resp.status_code == 403

    # 익명(미인증)은 401
    app.dependency_overrides.clear()
    async with _client() as client:
        anon_unblock_resp = await client.post(f"/api/community/notes/{thread_id}/unblock")
    assert anon_unblock_resp.status_code == 401

    # 인증됐지만 재학생 미인증이면 403 + 헤더
    app.dependency_overrides[get_current_user] = lambda: DecodedToken(
        uid="unblock-author", yonsei_verified=False
    )
    app.dependency_overrides[get_current_user_optional] = lambda: DecodedToken(
        uid="unblock-author", yonsei_verified=False
    )
    async with _client() as client:
        unverified_unblock_resp = await client.post(f"/api/community/notes/{thread_id}/unblock")
    assert unverified_unblock_resp.status_code == 403
    assert unverified_unblock_resp.headers["X-Auth-Requirement"] == "yonsei-verified"
    app.dependency_overrides.clear()

    authed_as("unblock-author")
    async with _client() as client:
        unblock_resp = await client.post(f"/api/community/notes/{thread_id}/unblock")
    assert unblock_resp.status_code == 200
    assert unblock_resp.json()["blocked"] is False

    # 핵심 계약: 해제 후 다시 메시지 전송이 된다
    authed_as("unblock-sender")
    async with _client() as client:
        resend_resp = await client.post(
            f"/api/community/notes/{thread_id}/messages", json={"body": "다시 보냅니다"}
        )
    assert resend_resp.status_code == 201


@pytest.mark.asyncio
async def test_unblock_on_not_blocked_thread_is_idempotent(
    authed_as: Callable[[str], None],
) -> None:
    """차단된 적 없는 스레드에 해제를 호출해도 에러 없이 통과한다(멱등 정책)."""
    authed_as("idempotent-author")
    async with _client() as client:
        post = await _create_post(client)

    authed_as("idempotent-sender")
    async with _client() as client:
        start_resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "안녕하세요"},
        )
        thread_id = start_resp.json()["id"]

    authed_as("idempotent-author")
    async with _client() as client:
        unblock_resp = await client.post(f"/api/community/notes/{thread_id}/unblock")
    assert unblock_resp.status_code == 200
    assert unblock_resp.json()["blocked"] is False


# --- 접근 제어 ---


@pytest.mark.asyncio
async def test_non_participant_gets_403_anonymous_gets_401(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("access-author")
    async with _client() as client:
        post = await _create_post(client)

    authed_as("access-sender")
    async with _client() as client:
        start_resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "안녕하세요"},
        )
        thread_id = start_resp.json()["id"]

    authed_as("third-party")
    async with _client() as client:
        third_party_resp = await client.get(f"/api/community/notes/{thread_id}/messages")
    assert third_party_resp.status_code == 403

    app.dependency_overrides.clear()
    async with _client() as client:
        anon_resp = await client.get(f"/api/community/notes/{thread_id}/messages")
    assert anon_resp.status_code == 401


@pytest.mark.asyncio
async def test_unverified_user_gets_403_with_header(
    authed_as: Callable[[str], None],
) -> None:
    authed_as("unverified-note-author")
    async with _client() as client:
        post = await _create_post(client)

    app.dependency_overrides[get_current_user] = lambda: DecodedToken(
        uid="unverified-note-sender", yonsei_verified=False
    )
    app.dependency_overrides[get_current_user_optional] = lambda: DecodedToken(
        uid="unverified-note-sender", yonsei_verified=False
    )
    async with _client() as client:
        resp = await client.post(
            "/api/community/notes",
            json={"targetType": "post", "targetId": post["id"], "body": "본문"},
        )
    assert resp.status_code == 403
    assert resp.headers["X-Auth-Requirement"] == "yonsei-verified"
