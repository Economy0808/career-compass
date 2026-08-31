/**
 * 과목 검색 API 클라이언트 - 사용자가 "기본 추천수업 군집"에 직접 검색해 실제
 * 개설 과목을 채워 넣을 수 있게 하는 데이터 공급원(사용자 지시: "학정번호와
 * 캠퍼스, 수업이름 검색필터로 스스로 검색해서 수업을 띄웠으면 좋겠어").
 *
 * lib/api.ts의 request()가 토큰 부착·에러 처리를 담당하는 관례를 그대로 따른다
 * (lib/explore-api.ts와 동일한 패턴).
 *
 * - GET /api/courses/search?q=&department=&college=&limit= → q는 과목명
 *   부분일치 또는 학정번호 부분/접두 일치를 하나로 처리한다. department/
 *   college는 정확일치이며 반드시 taxonomy 응답 값을 그대로 써야 한다(실
 *   데이터 학과명이 "철학과"가 아니라 "철학전공" 형태). limit은 기본 20,
 *   30 초과 시 서버가 30으로 클램프한다. 필터가 전부 비면 기본 상위 목록.
 * - GET /api/courses/taxonomy → 드롭다운용 { departments, colleges }.
 * - 응답은 exclude_none이라 campus 등 키 자체가 빠질 수 있다 - CourseDto는
 *   code/name만 필수로 보고 나머지는 전부 옵셔널로 다룬다. campus는 원천
 *   데이터에 컬럼이 없어 현재 항상 없음(이번 스코프에서 필터도 제외).
 * - 인증: 로그인만 필요(익명 401).
 */

import { request } from "./api";

// ---------- 동시 중복 요청 합치기 ----------
// CourseSearchPanel은 원소 보관함(bin) 개수만큼 동시에 마운트된다("수업"이
// 기본 원소 종류라 보관함마다 검색 패널이 뜬다). 각 인스턴스가 마운트 직후
// 독립적으로 taxonomy/search를 부르면 페이지 하나에 같은 요청이 N번(+React
// StrictMode의 effect 2회 실행까지 겹치면 더) 나간다. 이미 나가 있는 "같은
// 요청"이면 그 Promise를 그대로 돌려줘 실제 네트워크 호출을 하나로 합친다.
// 완료 즉시 캐시를 비우므로 이후 새 검색어/필터는 정상적으로 새로 나간다.
const inFlight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fetcher().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

export interface CourseDto {
  code: string;
  name: string;
  department?: string;
  college?: string;
  level?: number;
  credits?: number;
  kind?: string;
  campus?: string;
}

export interface CourseTaxonomyDto {
  departments: string[];
  colleges: string[];
}

export interface CourseSearchParams {
  q?: string;
  department?: string;
  college?: string;
  limit?: number;
}

export function searchCourses(params: CourseSearchParams = {}): Promise<CourseDto[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.department) qs.set("department", params.department);
  if (params.college) qs.set("college", params.college);
  if (params.limit) qs.set("limit", String(params.limit));
  const suffix = qs.toString();
  const path = `/api/courses/search${suffix ? `?${suffix}` : ""}`;
  return dedupe(path, () => request<CourseDto[]>(path));
}

export function getCourseTaxonomy(): Promise<CourseTaxonomyDto> {
  return dedupe("/api/courses/taxonomy", () => request<CourseTaxonomyDto>("/api/courses/taxonomy"));
}

// ---------- 캔버스 원소 변환 헬퍼 ----------
// page.tsx(보관함에 추가)와 CourseSearchPanel(중복 표시) 양쪽이 같은 규칙을
// 써야 하므로 여기 한 곳에 둔다.

/** 캔버스 원소 id 규칙 - 백엔드 bin_suggestion.py의 _course_item과 동일하게
 * 항상 `course:{학정번호}`로 고정한다. LLM이 채운 수업과 검색으로 직접 담은
 * 수업이 같은 과목이면 id가 자연히 겹쳐 중복 추가를 막아준다. */
export function courseItemId(code: string): string {
  return `course:${code}`;
}

// 검색 API의 level은 학정번호 첫 자리 그대로(1~4, MergedCourse.level 원시값)인
// 반면, ElementBinPanel의 groupByLevel/tierLabel은 "천 단위" 스케일(1000~4000,
// 백엔드 course_clustering.py의 _LEVEL_SCALE)을 기대한다. 이 경계에서 한 번만
// 보정해 LLM 원소와 검색으로 담은 원소의 학년 그룹핑이 어긋나지 않게 한다.
const LEVEL_SCALE = 1000;

export function scaleCourseLevel(level: number | undefined): number | undefined {
  return typeof level === "number" ? level * LEVEL_SCALE : undefined;
}
