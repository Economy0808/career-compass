"""테스트용 로드맵 생성 헬퍼: preview → plant 2단계 API를 한 번에 돌린다."""

from httpx import AsyncClient


async def preview_roadmap(
    client: AsyncClient, goal: str, messages: list[dict] | None = None
) -> dict:
    resp = await client.post(
        "/api/roadmap/preview", json={"goal_raw_text": goal, "messages": messages or []}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


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
