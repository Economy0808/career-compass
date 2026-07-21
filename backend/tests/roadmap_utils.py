"""테스트용 로드맵 생성 헬퍼: preview(잡 폴링) → plant 2단계를 한 번에 돌린다."""

import asyncio

from httpx import AsyncClient


async def preview_roadmap(
    client: AsyncClient, goal: str, messages: list[dict] | None = None
) -> dict:
    """POST /preview로 잡을 띄우고 done까지 폴링해 프리뷰 페이로드를 돌려준다.

    Mock LLM은 즉시 끝나므로 몇 번의 폴링이면 완료된다.
    """
    resp = await client.post(
        "/api/roadmap/preview", json={"goal_raw_text": goal, "messages": messages or []}
    )
    assert resp.status_code == 202, resp.text
    job_id = resp.json()["job_id"]
    for _ in range(200):
        status = await client.get(f"/api/roadmap/preview/{job_id}")
        assert status.status_code == 200, status.text
        data = status.json()
        if data["status"] == "done":
            assert data["result"] is not None
            return data["result"]
        if data["status"] == "error":
            raise AssertionError(f"preview job errored: {data.get('detail')}")
        await asyncio.sleep(0.02)
    raise AssertionError("preview job did not finish in time")


async def plant_from_preview(
    client: AsyncClient, preview: dict, goal: str, messages: list[dict] | None = None
) -> list[dict]:
    resp = await client.post(
        "/api/roadmap/plant",
        json={**preview, "goal_raw_text": goal, "messages": messages or []},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def plant_roadmap(
    client: AsyncClient, goal: str, messages: list[dict] | None = None
) -> list[dict]:
    """preview → plant를 연달아 호출해 저장된 RoadmapDetailOut 목록을 돌려준다."""
    preview = await preview_roadmap(client, goal, messages)
    return await plant_from_preview(client, preview, goal, messages)
