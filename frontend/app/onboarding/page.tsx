"use client";

/*
 * 회원가입(2단계 - 프로필 온보딩) - 가입 직후 학번·학과·관심사·동의를 받는다.
 *
 * 왜 별도 라우트인가: 계정만 생기고 온보딩을 마치지 않은 채 이탈한 유저를 다음
 * 로그인 때 여기로 되돌려 보내야 한다(limbo 방지, 백엔드 03-code-78 계약).
 * GET /api/profiles/me.onboardingComplete가 false면 로그인 후 여기로 라우팅한다
 * (그 필드가 붙는 대로 로그인 가드에 연결 - 지금은 가입 직후 진입만).
 *
 * 테마: login/signup과 같은 밝은 종이 오버레이(사용자 지시 - 서비스 이용 전
 * 부대 작업은 랜딩과 같은 테마). 폼 요소는 components/paper-form 공용.
 *
 * 개인정보(PIPA) - 보안 세션 70 + 백엔드 78 협의:
 * - 동의는 service(필수)·overseas(필수)·marketing(선택) 3개. service·overseas는
 *   물리적으로 분리된 체크박스여야 유효(하나로 묶으면 무효).
 * - 민감정보 별도동의(sensitive)는 두지 않는다 - 만드는 것 자체가 "민감정보 수집
 *   정상화"라, careerText에 인라인 경고로 최소화한다.
 * - ⚠️ overseas(국외이전) 법적 본문은 미확정(Anthropic 실명·연락처·보유기간은
 *   실제 약관/계약 확인 필요). UI 구조·필수 게이트는 완성하되 본문은 "준비 중"
 *   플레이스홀더 - 창업자(사용자) 결정 + 법무 확정 전 라이브 노출 금지.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { postProfileOnboarding } from "@/lib/api";
import { PaperField, PaperSelect, PaperTextarea } from "@/components/paper-form";

/** 관심사 태그 - 진로 탐색 축을 넓게 덮는 정본 어휘. 자유서술이 아니라 고른
 * 태그라야 맞춤 추천·군집이 안정적으로 먹는다(자유서술은 careerText로 따로). */
const INTEREST_TAGS = [
  "데이터·AI",
  "개발·프로그래밍",
  "경영·기획",
  "마케팅·브랜딩",
  "금융·회계",
  "디자인·UX",
  "창업",
  "대외활동·동아리",
  "인턴·현장실습",
  "자격증·고시",
  "대학원·연구",
  "글쓰기·콘텐츠",
  "공공·NGO",
  "해외·어학",
] as const;

const MAX_TAGS = 10; // 백엔드 계약: declaredTags 1~10개
const MAX_CAREER = 1000; // 백엔드 계약: careerText ≤ 1000자

/** 학년 - 백엔드는 int(1~6)를 받는다. 라벨은 사람이 읽고, value가 전송된다.
 * 초과학기는 5(1~6 범위 안). 빈 문자열 = 미선택(제출 검증에서 막힌다). */
const GRADE_OPTIONS: { label: string; value: number }[] = [
  { label: "1학년", value: 1 },
  { label: "2학년", value: 2 },
  { label: "3학년", value: 3 },
  { label: "4학년", value: 4 },
  { label: "초과학기", value: 5 },
];

const PAPER_DANGER = "color-mix(in srgb, var(--spec-m) 55%, var(--paper-ink))";

/** 종이 위 동의 한 줄 - 체크박스 + 라벨(+ 선택적 상세 disclosure). service·overseas는
 * 각각 독립 체크박스로 렌더돼야 유효하다(PIPA). */
function ConsentRow({
  id,
  checked,
  onChange,
  label,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-paper-line bg-paper-soft/40 p-3">
      <label
        htmlFor={id}
        className="flex cursor-pointer items-start gap-2 text-caption leading-relaxed text-paper-ink"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 accent-[var(--paper-ink)]"
        />
        <span>{label}</span>
      </label>
      {children && <div className="mt-2 pl-6">{children}</div>}
    </div>
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  // 비로그인 진입 방어(직접 URL 접근 등) - 온보딩은 인증 유저 전용.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const [studentId, setStudentId] = useState("");
  const [department, setDepartment] = useState("");
  const [doubleMajor, setDoubleMajor] = useState("");
  const [grade, setGrade] = useState<number | "">("");
  const [declaredTags, setDeclaredTags] = useState<string[]>([]);
  const [careerText, setCareerText] = useState("");
  // 동의 - service·overseas 필수, marketing 선택. 물리적 별도 체크박스.
  const [consentService, setConsentService] = useState(false);
  const [consentOverseas, setConsentOverseas] = useState(false);
  const [consentMarketing, setConsentMarketing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleTag(tag: string) {
    setDeclaredTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : prev.length >= MAX_TAGS
          ? prev // 최대 10개 - 초과 선택 무시
          : [...prev, tag]
    );
  }

  function validate(): string | null {
    if (!/^\d{10}$/.test(studentId.trim())) return "학번 10자리를 정확히 입력해주세요.";
    if (!department.trim()) return "학과를 입력해주세요.";
    if (grade === "") return "학년을 선택해주세요.";
    if (declaredTags.length < 1) return "관심사를 하나 이상 골라주세요.";
    if (careerText.trim().length > MAX_CAREER)
      return `자유서술은 ${MAX_CAREER}자 이내로 적어주세요.`;
    if (!consentService) return "개인정보 수집·이용(필수)에 동의해야 계속할 수 있어요.";
    if (!consentOverseas) return "AI 기능을 위한 국외이전(필수)에 동의해야 계속할 수 있어요.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setPending(true);
    setError(null);
    try {
      // 태그 트림·중복제거(백엔드도 재검증한다).
      const tags = Array.from(new Set(declaredTags.map((t) => t.trim()).filter(Boolean)));
      const trimmedCareer = careerText.trim();
      await postProfileOnboarding({
        studentId: studentId.trim(),
        department: department.trim(),
        doubleMajor: doubleMajor.trim() || undefined,
        grade: grade as number,
        declaredTags: tags,
        careerText: trimmedCareer || undefined,
        consents: {
          service: consentService,
          overseas: consentOverseas,
          marketing: consentMarketing,
        },
      });
      // 이메일 인증 안내와 다음 단계는 /verify에서 처리한다.
      router.push("/verify");
    } catch {
      setError("프로필 저장에 실패했어요. 잠시 후 다시 시도해주세요.");
      setPending(false);
    }
  }

  // 인증 확인 전에는 폼을 그리지 않는다(리다이렉트 결정까지 빈 화면).
  if (loading || !user) return null;

  return (
    <div
      className="paper-surface bg-paper-grid fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden"
      style={{ backgroundColor: "var(--paper)", color: "var(--paper-ink)" }}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-4 border md:inset-7"
        style={{ borderColor: "var(--paper-line)" }}
      />

      <header className="absolute inset-x-4 top-4 z-10 flex items-center justify-between px-6 py-5 md:inset-x-7 md:top-7 md:px-9">
        <Link
          href="/"
          className="font-serif text-title font-bold tracking-wide no-underline"
          style={{ color: "var(--paper-ink)" }}
        >
          OurLab
        </Link>
      </header>

      <div className="flex min-h-full items-center justify-center px-6 py-24">
        <div className="w-full max-w-[460px] rounded-lg border border-paper-line bg-paper p-8">
          <h1 className="font-serif text-display font-bold text-paper-ink">프로필 채우기</h1>
          <p className="mb-6 mt-[7px] text-body-sm leading-relaxed text-paper-lo">
            맞춤 로드맵을 만들려면 몇 가지가 필요해요. 학번은 본인확인·재학생 검증에만 써요.
          </p>

          <form onSubmit={submit} className="flex flex-col gap-4">
            <PaperField
              id="onb-student-id"
              label="학번 (10자리)"
              inputMode="numeric"
              autoFocus
              value={studentId}
              onChange={(e) => setStudentId(e.target.value.replace(/\D/g, "").slice(0, 10))}
              placeholder="2024123456"
              maxLength={10}
            />
            <PaperField
              id="onb-department"
              label="학과"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="예: 철학과"
              maxLength={40}
            />
            <PaperField
              id="onb-double-major"
              label="복수전공 / 부전공 (선택)"
              value={doubleMajor}
              onChange={(e) => setDoubleMajor(e.target.value)}
              placeholder="없으면 비워두세요"
              maxLength={40}
            />
            <PaperSelect
              id="onb-grade"
              label="학년"
              value={grade}
              onChange={(e) => setGrade(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">선택해주세요</option>
              {GRADE_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  {g.label}
                </option>
              ))}
            </PaperSelect>

            {/* 관심사 태그 - 최소 1개. 종이 테마 칩. */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between">
                <span className="text-caption font-semibold text-paper-lo">
                  관심사 (하나 이상)
                </span>
                <span className="text-micro text-paper-lo">
                  {declaredTags.length}/{MAX_TAGS}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {INTEREST_TAGS.map((tag) => {
                  const selected = declaredTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-caption transition-colors",
                        selected
                          ? "border-paper-ink bg-paper-ink text-paper"
                          : "border-paper-line bg-transparent text-paper-lo hover:bg-paper-soft"
                      )}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 진로 자유서술 - 선택. 민감정보 인라인 경고(별도동의 대신 최소화). */}
            <div className="flex flex-col gap-1.5">
              <PaperTextarea
                id="onb-career-text"
                label="관심사·진로를 더 적고 싶다면 (선택)"
                value={careerText}
                onChange={(e) => setCareerText(e.target.value.slice(0, MAX_CAREER))}
                rows={3}
                placeholder="어떤 진로를 그리고 있는지 자유롭게 적어주세요."
              />
              <p className="text-micro leading-relaxed text-paper-lo">
                <b className="text-paper-ink">건강·종교·정치성향 등 민감정보는 입력하지 마세요.</b>{" "}
                입력한 내용은 맞춤 추천에만 쓰여요.
              </p>
            </div>

            {/* 동의 - service·overseas는 각각 독립 체크박스(PIPA). */}
            <div className="mt-1 flex flex-col gap-2">
              <ConsentRow
                id="consent-service"
                checked={consentService}
                onChange={setConsentService}
                label={
                  <>
                    <b className="text-paper-ink">[필수]</b> 개인정보 수집·이용에 동의합니다.
                  </>
                }
              >
                <details className="text-micro leading-relaxed text-paper-lo">
                  <summary className="cursor-pointer font-semibold text-paper-ink">
                    자세히 보기
                  </summary>
                  <div className="mt-1.5 flex flex-col gap-1">
                    <p>
                      · 수집 항목: 학번, 학과, 복수/부전공, 학년, 관심사 태그, (선택) 진로 자유서술
                    </p>
                    <p>
                      · 이용 목적: 학번=본인확인·중복가입 방지·재학생 검증 / 학과·복수전공·학년=맞춤
                      로드맵 생성 / 관심사 태그=맞춤 추천
                    </p>
                    <p>
                      · 보유·이용 기간: 회원 탈퇴 시까지(관계 법령에 별도 보존의무가 있으면 그 기간)
                    </p>
                    <p>
                      · 동의를 거부할 권리가 있으며, 위 항목은 서비스 제공에 필요한 최소 정보이므로
                      거부 시 서비스 이용이 제한됩니다.
                    </p>
                  </div>
                </details>
              </ConsentRow>

              <ConsentRow
                id="consent-overseas"
                checked={consentOverseas}
                onChange={setConsentOverseas}
                label={
                  <>
                    <b className="text-paper-ink">[필수]</b> 개인정보 국외이전(AI 기능)에 동의합니다.
                  </>
                }
              >
                {/* ⚠️ 법적 본문 미확정 - 준비 중 플레이스홀더. 창업자 결정 + 법무 확정
                    전에는 라이브 노출 금지(백엔드 78 협의). */}
                <p className="text-micro leading-relaxed text-paper-lo">
                  AI 맞춤 기능을 쓰려면 입력 내용이 국외 AI 처리자에게 이전돼요. 상세 고지는{" "}
                  <b className="text-paper-ink">준비 중이에요.</b>
                </p>
              </ConsentRow>

              <ConsentRow
                id="consent-marketing"
                checked={consentMarketing}
                onChange={setConsentMarketing}
                label={
                  <>
                    <span className="text-paper-lo">[선택]</span> 마케팅·이벤트 정보 수신에 동의합니다.
                  </>
                }
              />
            </div>

            {error && (
              <p role="alert" className="text-caption" style={{ color: PAPER_DANGER }}>
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={pending}
              className="cta-ink mt-1 flex w-full items-center justify-center gap-2 rounded-md bg-paper-ink px-5 py-2.5 text-body-sm font-semibold text-paper transition-[filter,background-color] duration-150 disabled:pointer-events-none disabled:opacity-50"
            >
              {pending ? "저장하는 중…" : "시작하기"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
