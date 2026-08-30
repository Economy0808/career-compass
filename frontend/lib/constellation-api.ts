/**
 * 별자리(constellation) API 타입 클라이언트.
 *
 * 와이어 포맷 규약 (backend/app/schemas/constellation.py 모듈 docstring과 동일 -
 * 프론트/백엔드 양쪽에 고정된 계약이므로 어느 한쪽만 바꾸면 안 된다):
 *
 * 1. JSON 키는 camelCase다. 백엔드가 `alias_generator=to_camel`을 걸어 파이썬
 *    쪽 snake_case 필드명을 와이어에서만 camelCase로 바꾸므로, 이 파일의 타입도
 *    전부 camelCase로 정의한다.
 * 2. 시간(createdAt/updatedAt)은 epoch 밀리초 정수다. ISO 문자열이 아니다 -
 *    `b.updatedAt - a.updatedAt`처럼 산술 비교로 정렬하는 코드가 있으므로.
 * 3. 노드의 code/description/level/sourceRef/noteCount는 값이 없거나(null)
 *    noteCount가 0이면 라우터가 `response_model_exclude_none=True`로 응답에서
 *    아예 뺀다. 그래서 `null` 유니언이 아니라 `?:` 선택적 필드로만 타입을
 *    선언한다 - "없음"과 "0"을 구분해야 하는 UI 로직(노트 0개 vs 아직 없음)이
 *    undefined 여부로 그 둘을 가른다.
 * 4. 컬렉션 경로는 끝에 슬래시를 붙이지 않는다(`/api/constellations`,
 *    `/api/constellations/`가 아님) - FastAPI가 trailing slash 요청을 307로
 *    리다이렉트하는데, 그 과정에서 Authorization 헤더가 유실되어 인증이 깨진다.
 *
 * request()가 Authorization Bearer 토큰 부착을 대신 처리하므로(lib/api.ts),
 * 이 파일의 함수들은 경로 조립과 타입 매핑에만 집중한다. path segment로 들어가는
 * id(예: "element:phil-101")는 콜론 등 특수문자를 포함할 수 있으므로 전부
 * encodeURIComponent로 이스케이프한다.
 */

import { jsonInit, request } from "./api";

// ---------- 공통 도형 ----------

export interface PositionDto {
  x: number;
  y: number;
}

/** 백엔드 NodeOut과 1:1 대응. */
export interface NodeDto {
  id: string;
  label: string;
  type: string;
  isCompleted: boolean;
  position: PositionDto;
  origin: string;
  createdAt: number;
  code?: string;
  description?: string;
  level?: number;
  sourceRef?: string;
  noteCount?: number;
  color?: string;
  glowEffect?: string;
}

/** 백엔드 EdgeOut과 1:1 대응. */
export interface EdgeDto {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  color?: string;
}

/** 백엔드 GroupOut과 1:1 대응 - 캔버스 성단(요소가 많아진 노드 묶음). */
export interface GroupDto {
  id: string;
  label: string;
  memberNodeIds: string[];
  collapsed: boolean;
  position: PositionDto;
}

/** 백엔드 ConstellationOut과 1:1 대응. nodes/edges는 id를 key로 하는 맵 -
 * Firestore 점 표기 부분 업데이트와 형태를 맞춘 것이므로 배열로 바꾸지 않는다
 * (ConstellationCanvas.tsx의 동일한 관례 참고).
 * bins은 intake 플로우 후 추가된다. */
export interface ConstellationDto {
  id: string;
  ownerId: string;
  title: string;
  goalRawText: string;
  description?: string;
  contributors: string[];
  nodes: Record<string, NodeDto>;
  edges: Record<string, EdgeDto>;
  isPublished: boolean;
  createdAt: number;
  updatedAt: number;
  bins?: BinDto[];
  groups?: Record<string, GroupDto>;
}

/** 백엔드 NodeCreateIn과 1:1 대응. id는 클라이언트가 생성한다(예: "element:phil-101"). */
export interface NodeCreateInput {
  id: string;
  label: string;
  type: string;
  position: PositionDto;
  code?: string;
  description?: string;
  level?: number;
  sourceRef?: string;
  color?: string;
  glowEffect?: string;
}

/** 백엔드 EdgeCreateIn과 1:1 대응. id는 클라이언트가 생성한다. */
export interface EdgeCreateInput {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  color?: string;
}

/** 백엔드 AttachmentOut/AttachmentIn과 1:1 대응(요청/응답 형태가 동일). */
export interface AttachmentDto {
  id: string;
  name: string;
  mimeType: string;
  url: string;
}

/** 백엔드 NoteOut과 1:1 대응. */
export interface NoteDto {
  id: string;
  nodeId: string;
  ownerId: string;
  title: string;
  body: string;
  isPublic: boolean;
  attachments: AttachmentDto[];
  createdAt: number;
  updatedAt: number;
}

/** 백엔드 NoteCreateIn과 1:1 대응. id는 선택 - 없으면 서버가 uuid4를 생성한다. */
export interface NoteCreateInput {
  id?: string;
  nodeId: string;
  title: string;
  body: string;
  isPublic: boolean;
  attachments: AttachmentDto[];
}

/** 백엔드 NotePatchIn과 1:1 대응(자동저장 hot path). */
export interface NotePatchInput {
  title: string;
  body: string;
  isPublic: boolean;
  attachments: AttachmentDto[];
}

// ---------- 별자리 Intake 채팅 및 구간 생성 ----------

/**
 * 별자리 Intake 플로우에서 쓰인다:
 *
 * 사용자가 목표를 설명하면, 서버는 여러 턴에 걸쳐 목표를 다듬기 위해 대화한다.
 * 각 요청(POST /api/constellation-intake/chat)은 전체 메시지 히스토리를 포함해야 한다.
 * 중요: 서버의 응답에서 받은 messages 배열은 서버가 이미 갱신한 전체 히스토리다.
 * 프론트엔드는 그 messages를 다음 요청에 그대로 다시 보내야 한다(무한 질문 루프 방지 +
 * 서버 state 싱크).
 */
export interface ChatMessageDto {
  role: "user" | "assistant";
  content: string;
}

export interface IntakeChatResponse {
  reply: string | null;
  done: boolean;
  messages: ChatMessageDto[];
  /** 지금 질문 아래 뜨는 한 줄 힌트(board 3) - done이면 null. */
  hint: string | null;
  /** 입력 보조 칩 2~4개 - 클릭하면 그 텍스트로 그대로 제출된다. done이면 []. */
  options: string[];
}

export interface JobStartResponse {
  jobId: string;
  status: string;
}

export interface BinItemDto {
  id: string;
  label: string;
  type: string;
  level?: number;
  subtitle?: string;
  description?: string;
  prereqIds?: string[];
  /** 과목의 소속 학과(4792fe4). 학과별 bin을 하나로 병합해도 아이템이 자기 학과를
   * 들고 다니므로, 저장 후 재로드해도 배지가 유지된다. 구 문서에는 키가 없다. */
  department?: string;
}

export interface BinDto {
  id: string;
  label: string;
  origin: "llm" | "user";
  advice?: string;
  items: BinItemDto[];
}

/** LLM이 대화 내용을 바탕으로 미리 짜 준 별자리 초안 하나(c368bb5 계약).
 * 시안은 더 이상 항목을 발췌하지 않는다 - bins는 항상 전부(full load)
 * 표시된다는 전제 위에서, 안별 차이는 강조(coreBinLabels)와 성단 간 학습
 * 경로(binEdges)뿐이다. 둘 다 bins의 label 그대로를 가리킨다(id가 아님 -
 * 프론트가 보여주는 단위가 개별 item이 아니라 bin 전체이므로). */
export interface DraftDto {
  name: string;
  tagline: string;
  /** 이 안의 핵심 군집 2~4개 - bins[].label과 정확히 일치. */
  coreBinLabels: string[];
  /** 군집 간 학습 경로 3~8개 - 각 튜플은 bins[].label 쌍. */
  binEdges: [string, string][];
}

export interface BinJobStatusResponse {
  status: "pending" | "running" | "done" | "error";
  result: { bins: BinDto[]; drafts?: DraftDto[] } | null;
  detail: string | null;
}

// ---------- 별자리 ----------

export function createConstellation(input: {
  title: string;
  goalRawText: string;
  nodes: NodeCreateInput[];
  edges: EdgeCreateInput[];
  bins?: BinDto[];
}): Promise<ConstellationDto> {
  return request<ConstellationDto>("/api/constellations", jsonInit("POST", input));
}

export function listConstellations(): Promise<ConstellationDto[]> {
  return request<ConstellationDto[]>("/api/constellations");
}

export function getConstellation(constellationId: string): Promise<ConstellationDto> {
  return request<ConstellationDto>(`/api/constellations/${encodeURIComponent(constellationId)}`);
}

export function listUserConstellations(uid: string): Promise<ConstellationDto[]> {
  return request<ConstellationDto[]>(`/api/constellations/user/${encodeURIComponent(uid)}`);
}

export function deleteConstellation(constellationId: string): Promise<void> {
  return request<void>(`/api/constellations/${encodeURIComponent(constellationId)}`, {
    method: "DELETE",
  });
}

// ---------- 노드 ----------

export function addNode(
  constellationId: string,
  input: NodeCreateInput
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/nodes`,
    jsonInit("POST", input)
  );
}

export function deleteNode(constellationId: string, nodeId: string): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/nodes/${encodeURIComponent(nodeId)}`,
    { method: "DELETE" }
  );
}

export function patchNodePosition(
  constellationId: string,
  nodeId: string,
  position: PositionDto
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/nodes/${encodeURIComponent(nodeId)}/position`,
    jsonInit("PATCH", { position })
  );
}

export function patchNodeCompletion(
  constellationId: string,
  nodeId: string,
  isCompleted: boolean
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/nodes/${encodeURIComponent(nodeId)}/completion`,
    jsonInit("PATCH", { isCompleted })
  );
}

export function patchNodeColor(
  constellationId: string,
  nodeId: string,
  color: string
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/nodes/${encodeURIComponent(nodeId)}/color`,
    jsonInit("PATCH", { color })
  );
}

/** glowEffect가 null이면 기본 연출로 되돌린다 (patchNodeColor와 대칭). */
export function patchNodeGlow(
  constellationId: string,
  nodeId: string,
  glowEffect: string | null
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/nodes/${encodeURIComponent(nodeId)}/glow`,
    jsonInit("PATCH", { glowEffect })
  );
}

// ---------- 엣지 ----------

export function addEdge(
  constellationId: string,
  input: EdgeCreateInput
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/edges`,
    jsonInit("POST", input)
  );
}

export function deleteEdge(constellationId: string, edgeId: string): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/edges/${encodeURIComponent(edgeId)}`,
    { method: "DELETE" }
  );
}

/** color가 null이면 커스텀 색을 지우고 프론트 기본색으로 되돌린다 (patchNodeColor와 대칭). */
export function patchEdgeColor(
  constellationId: string,
  edgeId: string,
  color: string | null
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/edges/${encodeURIComponent(edgeId)}/color`,
    jsonInit("PATCH", { color })
  );
}

// ---------- 성단(그룹) ----------

/** 성단 생성 요청. id는 클라이언트가 생성한다. collapsed 기본값은 서버가 true로 채운다. */
export function createGroup(
  constellationId: string,
  input: { id: string; label: string; memberNodeIds: string[]; position: PositionDto; collapsed?: boolean }
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/groups`,
    jsonInit("POST", input)
  );
}

/** 성단 부분 갱신 - 넘기지 않은 필드는 서버가 기존 값을 유지한다. */
export function patchGroup(
  constellationId: string,
  groupId: string,
  patch: { label?: string; collapsed?: boolean; memberNodeIds?: string[]; position?: PositionDto }
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/groups/${encodeURIComponent(groupId)}`,
    jsonInit("PATCH", patch)
  );
}

/** 성단만 삭제한다("해제") - 멤버 노드는 그대로 남는다. */
export function deleteGroup(constellationId: string, groupId: string): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/groups/${encodeURIComponent(groupId)}`,
    { method: "DELETE" }
  );
}

// ---------- 노트 ----------

export function createNote(constellationId: string, input: NoteCreateInput): Promise<NoteDto> {
  return request<NoteDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/notes`,
    jsonInit("POST", input)
  );
}

export function listNotes(constellationId: string): Promise<NoteDto[]> {
  return request<NoteDto[]>(`/api/constellations/${encodeURIComponent(constellationId)}/notes`);
}

export function patchNote(
  constellationId: string,
  noteId: string,
  patch: NotePatchInput
): Promise<NoteDto> {
  return request<NoteDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/notes/${encodeURIComponent(noteId)}`,
    jsonInit("PATCH", patch)
  );
}

export function deleteNote(constellationId: string, noteId: string): Promise<void> {
  return request<void>(
    `/api/constellations/${encodeURIComponent(constellationId)}/notes/${encodeURIComponent(noteId)}`,
    { method: "DELETE" }
  );
}

// ---------- Intake 채팅 및 구간 생성 ----------

export function intakeChat(input: {
  goalRawText: string;
  messages: ChatMessageDto[];
}): Promise<IntakeChatResponse> {
  return request<IntakeChatResponse>(
    "/api/constellation-intake/chat",
    jsonInit("POST", input)
  );
}

export function startBinSuggestJob(goalText: string): Promise<JobStartResponse> {
  return request<JobStartResponse>(
    "/api/constellation-intake/bins",
    jsonInit("POST", { goalText })
  );
}

export function startBinFillJob(goalText: string, binLabel: string): Promise<JobStartResponse> {
  return request<JobStartResponse>(
    "/api/constellation-intake/bins/fill",
    jsonInit("POST", { goalText, binLabel })
  );
}

export function getBinJob(jobId: string): Promise<BinJobStatusResponse> {
  return request<BinJobStatusResponse>(
    `/api/constellation-intake/jobs/${encodeURIComponent(jobId)}`
  );
}

/** POST /api/constellation-intake/prereqs 응답 - before가 선수, after가
 * 후수(둘 다 "course:CODE" 형식, BinItem.id와 동일). 성운 다이브인 시점에
 * 온디맨드로만 호출한다(과목마다 미리 이어두지 않는다 - 사용자 지시). */
export interface PrereqEdgeDto {
  before: string;
  after: string;
}

export function inferPrereqs(
  items: { code: string; name: string; level: number | null; kind: string | null }[]
): Promise<PrereqEdgeDto[]> {
  return request<{ edges: PrereqEdgeDto[] }>(
    "/api/constellation-intake/prereqs",
    jsonInit("POST", { items })
  ).then((res) => res.edges);
}

export function putBins(
  constellationId: string,
  bins: BinDto[]
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/bins`,
    jsonInit("PUT", { bins })
  );
}

/** 발행 상태 및 메타데이터 패치 입력. */
export interface PublishPatch {
  isPublished: boolean;
  title?: string;
  description?: string;
  contributors?: string[];
}

export function patchPublish(
  constellationId: string,
  patch: PublishPatch
): Promise<ConstellationDto> {
  return request<ConstellationDto>(
    `/api/constellations/${encodeURIComponent(constellationId)}/publish`,
    jsonInit("PATCH", patch)
  );
}
