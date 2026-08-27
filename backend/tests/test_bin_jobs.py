"""회수 추천 비동기 잡 매니저 테스트."""

import asyncio
from typing import Any

import pytest

from app.services import bin_jobs


@pytest.fixture(autouse=True)
def _reset_bin_jobs():
    """매 테스트 후 bin_jobs 상태를 정리하여 테스트 격리를 보장한다."""
    yield
    bin_jobs.reset_jobs()


class TestCreateJob:
    """create_job 함수 테스트."""

    def test_create_job_returns_pending_job_with_uuid_id(self) -> None:
        """새 잡은 pending 상태이고 uuid hex id를 가진다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)

        assert job.id is not None
        assert len(job.id) == 32  # uuid4().hex의 길이
        assert job.uid == uid
        assert job.status == "pending"
        assert job.result is None
        assert job.detail is None
        assert job.created_at > 0

    def test_create_job_multiple_calls_generate_different_ids(self) -> None:
        """연속 호출 시 서로 다른 id를 생성한다."""
        uid = "user123"
        job1 = bin_jobs.create_job(uid)
        job2 = bin_jobs.create_job(uid)

        assert job1.id != job2.id


class TestGetJob:
    """get_job 함수 테스트."""

    def test_get_job_with_correct_uid_returns_job(self) -> None:
        """올바른 uid로 조회하면 잡을 반환한다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)

        retrieved = bin_jobs.get_job(job.id, uid)

        assert retrieved is not None
        assert retrieved.id == job.id
        assert retrieved.uid == uid

    def test_get_job_with_wrong_uid_returns_none(self) -> None:
        """다른 uid로 조회하면 None을 반환한다 (타인 열람 방지)."""
        uid1 = "user123"
        uid2 = "user456"
        job = bin_jobs.create_job(uid1)

        retrieved = bin_jobs.get_job(job.id, uid2)

        assert retrieved is None

    def test_get_job_with_nonexistent_id_returns_none(self) -> None:
        """없는 job_id로 조회하면 None을 반환한다."""
        retrieved = bin_jobs.get_job("nonexistent_id", "user123")

        assert retrieved is None


class TestLaunch:
    """launch 함수 테스트."""

    @pytest.mark.asyncio
    async def test_launch_with_succeeding_coroutine_sets_done_status(
        self,
    ) -> None:
        """성공한 코루틴은 잡 상태를 done으로 설정하고 결과를 저장한다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)
        expected_result: dict[str, Any] = {"key": "value", "number": 42}

        async def work() -> dict[str, Any]:
            await asyncio.sleep(0.01)
            return expected_result

        bin_jobs.launch(job, work)
        # 백그라운드 태스크가 완료될 시간을 준다.
        await asyncio.sleep(0.05)

        assert job.status == "done"
        assert job.result == expected_result
        assert job.detail is None

    @pytest.mark.asyncio
    async def test_launch_with_raising_coroutine_sets_error_status(
        self,
    ) -> None:
        """예외 발생 코루틴은 잡 상태를 error로 설정하고 한글 에러 메시지를 저장한다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)

        async def failing_work() -> dict[str, Any]:
            await asyncio.sleep(0.01)
            raise ValueError("뭔가 잘못됨")

        bin_jobs.launch(job, failing_work)
        # 백그라운드 태스크가 완료될 시간을 준다.
        await asyncio.sleep(0.05)

        assert job.status == "error"
        assert job.result is None
        assert job.detail == "회수 추천을 받지 못했어요. 잠시 후 다시 시도해주세요."

    @pytest.mark.asyncio
    async def test_launch_does_not_escape_exception(self) -> None:
        """launch는 백그라운드 태스크 내 예외를 잡아내서 호출자에게 던지지 않는다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)

        async def failing_work() -> dict[str, Any]:
            raise RuntimeError("테스트 에러")

        # launch 호출이 예외를 던지지 않아야 한다.
        bin_jobs.launch(job, failing_work)
        # 백그라운드 태스크가 완료될 시간을 준다.
        await asyncio.sleep(0.05)

        # 예외가 발생하지 않았으므로 pass


class TestTTLPrune:
    """TTL 정리 기능 테스트."""

    def test_done_job_older_than_ttl_is_pruned_on_create(self) -> None:
        """TTL을 초과한 done 상태 잡은 create_job 호출 시 정리된다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)
        job.status = "done"

        # 잡의 created_at을 TTL보다 오래된 값으로 변경한다.
        job.created_at = job.created_at - (bin_jobs._TTL_SECONDS + 100)

        # 다른 잡 생성 시 _prune()이 호출되어 오래된 잡을 정리한다.
        new_job = bin_jobs.create_job(uid)

        # 원래 잡은 사라져야 한다.
        assert bin_jobs.get_job(job.id, uid) is None
        assert bin_jobs.get_job(new_job.id, uid) is not None

    def test_error_job_older_than_ttl_is_pruned_on_get(self) -> None:
        """TTL을 초과한 error 상태 잡은 get_job 호출 시도 정리된다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)
        job.status = "error"
        job.created_at = job.created_at - (bin_jobs._TTL_SECONDS + 100)

        # create_job 호출로 _prune() 실행
        bin_jobs.create_job(uid)

        # 원래 잡은 조회 불가
        assert bin_jobs.get_job(job.id, uid) is None

    def test_pending_job_not_pruned_even_if_old(self) -> None:
        """pending 상태 잡은 오래되었어도 정리되지 않는다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)
        # pending 상태로 둔다.
        job.created_at = job.created_at - (bin_jobs._TTL_SECONDS + 100)

        # 다른 잡 생성
        bin_jobs.create_job(uid)

        # pending 잡은 여전히 조회 가능
        assert bin_jobs.get_job(job.id, uid) is not None

    def test_running_job_not_pruned_even_if_old(self) -> None:
        """running 상태 잡은 오래되었어도 정리되지 않는다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)
        job.status = "running"
        job.created_at = job.created_at - (bin_jobs._TTL_SECONDS + 100)

        # 다른 잡 생성
        bin_jobs.create_job(uid)

        # running 잡은 여전히 조회 가능
        assert bin_jobs.get_job(job.id, uid) is not None


class TestMaxJobsEviction:
    """최대 잡 수 상한과 축출 로직 테스트."""

    def test_creating_501_jobs_evicts_oldest(self) -> None:
        """500개 상한을 초과하는 501번째 잡 생성 시 가장 오래된 잡이 축출된다."""
        uid = "user123"
        jobs = []

        # 500개 잡 생성
        for _i in range(bin_jobs._MAX_JOBS):
            job = bin_jobs.create_job(uid)
            jobs.append(job)

        assert len(bin_jobs._jobs) == bin_jobs._MAX_JOBS

        # 가장 오래된 잡을 기억한다.
        oldest_job = jobs[0]

        # 501번째 잡 생성
        new_job = bin_jobs.create_job(uid)

        # 가장 오래된 잡은 축출되어야 한다.
        assert bin_jobs.get_job(oldest_job.id, uid) is None
        # 새 잡은 있어야 한다.
        assert bin_jobs.get_job(new_job.id, uid) is not None
        # 전체 개수는 여전히 500개
        assert len(bin_jobs._jobs) == bin_jobs._MAX_JOBS

    def test_eviction_preserves_other_jobs(self) -> None:
        """축출 시에도 다른 잡들은 보존된다."""
        uid = "user123"
        jobs = []

        # 501개 생성 (첫 번째가 축출됨)
        for _i in range(bin_jobs._MAX_JOBS + 1):
            job = bin_jobs.create_job(uid)
            jobs.append(job)

        # 두 번째부터 마지막까지의 잡들은 여전히 존재해야 한다.
        for i in range(1, len(jobs)):
            assert bin_jobs.get_job(jobs[i].id, uid) is not None


class TestResetJobs:
    """reset_jobs 헬퍼 함수 테스트."""

    @pytest.mark.asyncio
    async def test_reset_jobs_clears_all_jobs(self) -> None:
        """reset_jobs는 모든 잡을 정리한다."""
        uid = "user123"
        job1 = bin_jobs.create_job(uid)
        job2 = bin_jobs.create_job(uid)

        bin_jobs.reset_jobs()

        assert bin_jobs.get_job(job1.id, uid) is None
        assert bin_jobs.get_job(job2.id, uid) is None

    @pytest.mark.asyncio
    async def test_reset_jobs_cancels_running_tasks(self) -> None:
        """reset_jobs는 실행 중 태스크를 취소한다."""
        uid = "user123"
        job = bin_jobs.create_job(uid)

        call_count = 0

        async def long_work() -> dict[str, Any]:
            nonlocal call_count
            call_count += 1
            await asyncio.sleep(10)  # 오래 대기
            return {}

        bin_jobs.launch(job, long_work)
        await asyncio.sleep(0.05)  # 태스크 시작 보장

        # 시작했지만 아직 완료되지 않음
        assert job.status == "running"
        initial_task_count = len(bin_jobs._tasks)
        assert initial_task_count > 0

        bin_jobs.reset_jobs()

        # 태스크가 모두 취소되어야 한다.
        assert len(bin_jobs._tasks) == 0
