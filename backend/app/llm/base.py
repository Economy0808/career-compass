"""로드맵 질답/생성을 담당하는 LLM 클라이언트의 공통 인터페이스.

/chat는 stateless: 프론트가 전체 대화 히스토리(messages)를 들고 있다가
매 호출마다 재전송한다. 백엔드/LLM 클라이언트는 호출 간 상태를 갖지 않는다.

정밀 생성 파이프라인은 세 단계로 나뉜다 (roadmap_gen 서비스가 오케스트레이션):
  1. extract_intent  — 유저의 글/파일에서 진로 방향과 현재 수준을 뽑는다 (싼 모델)
  2. (서비스가 NCS 매칭 + job_research 캐시 조회를 수행)
  3. synthesize_roadmap — 의중 + NCS 능력단위 + 리서치를 종합해 마일스톤 생성 (강한 모델)

research_job은 요청 경로가 아니라 월간 배치(scripts/refresh_job_research.py)에서만
호출된다 — 웹 검색을 쓰므로 유저 생성 지연/비용에 영향을 주지 않는다.
"""

from dataclasses import dataclass, field
from datetime import date
from typing import Literal, Protocol

Role = Literal["user", "assistant"]


@dataclass
class ChatMessage:
    role: Role
    content: str


@dataclass
class ChatTurn:
    done: bool
    question: str | None  # done=True이면 None
    hint: str | None = None  # 질문 아래 뜨는 한 줄 힌트 (board 3) - done이면 None
    options: list[str] = field(default_factory=list)  # 입력 보조 칩 2~4개 - done이면 []


@dataclass
class CareerIntent:
    """유저 입력에서 뽑아낸 진로 의중."""

    summary: str  # 한 줄 요약 (유저가 지향하는 것)
    direction_keywords: list[str]  # NCS 직무 매칭용 키워드 (예: ["데이터 분석", "통계"])
    current_level: str  # 현재 수준/배경 (예: "1학년, 파이썬 입문")


@dataclass
class GeneratedMilestone:
    title: str
    description: str  # 한 줄 프리뷰 (스크롤 뷰용, ~60자)
    detail: str  # 상세 가이드: 무엇을/왜/어떻게 + 완료 기준 (클릭 시 표시)
    due_date: date


@dataclass
class CareerGoalRef:
    """유저의 기존 대목표 (분류 입력용)."""

    id: int
    title: str
    context: str


@dataclass
class MajorGoalDecision:
    """이 로드맵이 속할 대목표 판단 결과.

    existing_goal_id가 None이면 title로 새 대목표를 만든다.
    context는 이후 대화에서 재사용할 유저 프로필 요약(갱신본).
    """

    existing_goal_id: int | None
    title: str
    context: str


@dataclass
class GeneratedRoadmapItem:
    """세트를 구성하는 개별 소분류 로드맵 (한 주제에 집중, 직접 따라할 수 있는 수준)."""

    title: str
    milestones: list[GeneratedMilestone]


@dataclass
class GeneratedRoadmapSet:
    """한 번의 씨앗 심기 결과: 브리핑 + 대목표 판단 + 소분류 로드맵 1개 이상.

    목표가 여러 역량 축(수학/통계/프로젝트/네트워킹 등)에 걸치면 모델이 축별로
    로드맵을 분리한다. #N 넘버링은 모델이 아니라 plant 시점에 서버가 붙인다.
    """

    # 심기 직전 코치 브리핑: 필요 역량 + 왜 이 소목표들이 현실적 첫 단계인지
    briefing: str
    major_goal: MajorGoalDecision | None
    items: list[GeneratedRoadmapItem]
    # 합성이 웹 검색을 썼다면 참고한 출처 URL(도메인별 대표 1개). 프리뷰 출처 뱃지용 —
    # 저장하지 않고 프리뷰 응답으로만 흘려보낸다 (컴플라이언스: URL만, 원문·PII 저장 없음).
    source_urls: list[str] = field(default_factory=list)


@dataclass
class AbilityUnitRef:
    """NCS 능력단위 참조 (그라운딩 입력)."""

    code: str
    name: str


@dataclass
class NcsJobOption:
    """LLM 직무 판정에 넘기는 후보 (유저가 고른 대분류 안의 직무)."""

    code: str
    name: str
    sclas_name: str  # 소분류명 — 같은 이름끼리 구분할 문맥


@dataclass
class CourseOption:
    """수업 군집화 판단에 넘기는 후보 과목 (course_catalog에서 학과로 좁힌 결과)."""

    code: str
    name: str
    description: str | None
    level: int | None  # 학정번호 첫 자리 기반 계층(1~4). 100% 커버리지.
    years: list[int]  # 개설 학년(수강 가능 학년) — level과 다른 개념, 섞지 말 것.
    kind: str | None  # 전기/전필/전선 등
    department: str | None


@dataclass
class ClusteredCourse:
    """군집에 속한 과목 — code는 반드시 후보 목록에 있던 것 그대로(환각 방지)."""

    code: str
    name: str
    level: int | None
    reason: str  # 이 과목이 왜 이 목표에 맞는지 한 줄 근거


@dataclass
class CourseCluster:
    """LLM이 목표에 맞춰 즉석에서 이름 붙인 군집. 고정 목록이 아니다."""

    name: str
    courses: list[ClusteredCourse] = field(default_factory=list)
    # 이 군집이 왜 목표에 필요한지에 대한 코치 코멘트. 학사 규정(rules_context)이
    # 주어지면 그 근거를 반영한다. 모델이 못 채우면 None(빈 값 허용).
    advice: str | None = None


@dataclass
class CourseClusterResult:
    clusters: list[CourseCluster] = field(default_factory=list)


@dataclass
class SupportElement:
    """수업이 아닌 비교과 준비 요소 한 건 (자격증/학회/대외활동/네트워킹).

    수업과 달리 고정 카탈로그가 없어 code로 환각을 걸러낼 수 없다 —
    cluster_courses와는 별도의 가벼운 호출(suggest_support_elements)로 생성한다.
    """

    label: str
    type: str  # NodeTypes 값 중 하나 (certification/organization/activity/networking)
    subtitle: str | None = None  # 짧은 부제 (팝오버 위에 표시)
    description: str | None = None  # 팝오버 안에 보이는 2~3줄 설명


@dataclass
class SupportBin:
    """LLM이 즉석에서 이름 붙인 비교과 준비 요소 군집."""

    name: str
    advice: str | None = None
    elements: list[SupportElement] = field(default_factory=list)


@dataclass
class SupportBinResult:
    bins: list[SupportBin] = field(default_factory=list)


@dataclass
class DraftConstellation:
    """LLM이 구성한 성단 전체 배치 초안 하나 - 유저가 고를 3개 중 하나.

    시안은 더 이상 항목을 발췌하지 않는다 - suggest_all_bins가 만든 bins는
    항상 전부(full load) 표시된다는 전제 위에서, 안별 차이는 강조와 경로뿐이다.
    core_bin_labels/bin_edges는 반드시 그 bins의 label 그대로여야 한다(환각
    방지 - 구현체가 파싱 후 검증/제거한다). id가 아니라 label 기반인 이유는
    프론트가 보여주는 단위가 개별 item이 아니라 bin 전체이기 때문이다.
    """

    name: str  # 짧은 은유형 이름 (예: "관찰하는 사람")
    tagline: str  # 한 줄 설명
    core_bin_labels: list[str] = field(default_factory=list)  # 이 안의 핵심 군집 2~4개
    bin_edges: list[tuple[str, str]] = field(default_factory=list)  # 군집 간 학습 경로


@dataclass
class DraftResult:
    drafts: list[DraftConstellation] = field(default_factory=list)


@dataclass
class JobResearchResult:
    """직종별 웹 리서치 결과 — 요약 + 출처 링크만 (원문 복제 금지)."""

    summary: str
    activities: list[str] = field(default_factory=list)  # 대외활동/공모전 등
    academic_societies: list[str] = field(default_factory=list)  # 학회 (연세/수도권)
    expert_insights: list[str] = field(default_factory=list)  # 전문가 글 요지 (익명 요약)
    source_urls: list[str] = field(default_factory=list)  # 출처 링크


@dataclass
class RoadmapContext:
    """synthesize_roadmap에 넘기는 그라운딩 컨텍스트."""

    intent: CareerIntent
    ncs_job_name: str | None = None
    ability_units: list[AbilityUnitRef] = field(default_factory=list)
    research: JobResearchResult | None = None
    # 유저의 기존 대목표 목록 — 모델이 기존 것 재사용/신규 생성을 판단한다.
    existing_goals: list[CareerGoalRef] = field(default_factory=list)


class LLMClient(Protocol):
    async def chat(
        self,
        goal_raw_text: str,
        messages: list[ChatMessage],
        known_profile: str | None = None,
    ) -> ChatTurn:
        """지금까지의 질답(messages)을 보고 다음 질문을 내거나 종료를 판단한다.

        known_profile: 기존 대목표들에 저장된 유저 프로필 요약 —
        이미 아는 정보는 다시 묻지 않도록 프롬프트에 주입한다.
        """
        ...

    async def extract_intent(self, goal_raw_text: str, messages: list[ChatMessage]) -> CareerIntent:
        """유저 입력에서 진로 방향·현재 수준을 구조화해 뽑는다 (싼 모델)."""
        ...

    async def select_ncs_job(
        self, intent: CareerIntent, candidates: list[NcsJobOption]
    ) -> str | None:
        """후보 직무 중 의중에 실제로 맞는 것의 코드를 고른다. 없으면 None (싼 모델).

        **맞는 게 없으면 None을 내는 것이 이 메서드의 존재 이유다.** 후보는 유저가
        고른 대분류 전체라서 무관한 직무가 대부분이고, NCS에 아예 없는 진로
        (간호사·교사 등 별도 자격 체계)도 흔하다. 억지로 고른 직무는 그라운딩을
        오염시켜 로드맵 품질을 떨어뜨리므로, 확신이 없으면 비워두는 편이 낫다.
        """
        ...

    async def synthesize_roadmap(self, context: RoadmapContext) -> GeneratedRoadmapSet:
        """의중 + NCS 능력단위 + 리서치를 종합해 소분류 로드맵 세트를 생성한다 (강한 모델)."""
        ...

    async def select_relevant_departments(
        self,
        goal_text: str,
        known_departments: list[str] | None = None,
        known_colleges: list[str] | None = None,
    ) -> list[str]:
        """진로 목표와 관련 있는 단과대/학과 이름을 고른다 (수업 후보 좁히기 1단계).

        임베딩 유사도 대신 카테고리로 후보를 좁힌 뒤 LLM이 판단하는 패턴 —
        select_ncs_job과 동일하게, 확신이 없으면 빈 리스트를 내는 것이 정상이다.

        known_departments/known_colleges: course_repo.list_taxonomy가 스캔한 카탈로그의
        실제 학과/단과대 이름 목록 - 주어지면 구현체가 이 목록에 있는 이름만 반환하도록
        그라운딩해야 한다(그래야 이어지는 Firestore 조회가 실제로 문서를 찾는다).
        기본값 None이라 기존 호출부와 호환된다.
        """
        ...

    async def cluster_courses(
        self,
        goal_text: str,
        courses: list[CourseOption],
        rules_context: str | None = None,
    ) -> CourseClusterResult:
        """좁혀진 후보 과목 중 목표에 실제로 맞는 것을 골라 이름 붙인 군집으로 묶는다.

        군집 이름은 목표별로 모델이 즉석에서 짓는다(고정 목록 아님). 정렬(계층
        규칙 적용)은 이 메서드의 책임이 아니라 course_clustering 서비스가 한다.

        rules_context: 학사 규정 발췌(전과 선이수 학점, 복수전공 정원 등) —
        주어지면 군집별 advice의 근거로 활용한다. None이면 규정 근거 없이 생성한다.
        """
        ...

    async def suggest_support_elements(
        self, goal_text: str, rules_context: str | None = None
    ) -> SupportBinResult:
        """수업이 아닌 비교과 준비 요소(자격증/학회/대외활동/네트워킹)를 군집으로 제안한다.

        cluster_courses는 코드 기반 환각 방어가 있지만, 이 요소들은 고정 카탈로그가
        없어 같은 방어를 쓸 수 없다 — 그래서 별도의 가벼운 호출로 분리한다. 결과는
        어디까지나 AI 제안이며 카탈로그 그라운딩이 없다.
        """
        ...

    async def research_job(
        self, job_name: str, ability_units: list[AbilityUnitRef]
    ) -> JobResearchResult:
        """웹 검색으로 직종별 학회·대외활동·전문가 인사이트를 조사한다 (월간 배치 전용)."""
        ...

    async def suggest_draft_constellations(
        self, goal_text: str, bins_payload: list[dict]
    ) -> DraftResult:
        """유저가 고를 성단 배치 초안 3개를, bins 전체를 다 띄운다는 전제로 구성한다.

        bins_payload는 bin_suggestion.suggest_all_bins가 이미 만든 wire-ready
        bins 리스트(id/label/items)다 - 항목을 발췌하지 않고, 각 안은 이 bins의
        label 중 핵심 군집(core_bin_labels 2~4개)과 그 사이 학습 경로(bin_edges)만
        다르게 고른다. cluster_courses의 by_code 검증과 같은 이유로, 구현체는
        파싱 후 목록에 없는 label/edge를 직접 제거해야 한다(환각 방어).
        """
        ...
