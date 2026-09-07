"use client";

/*
 * 자격증 검색 + 제보 디렉터리 - 인테이크가 LLM으로 지어내던 자격증 정보를
 * 큐레이션(Q-Net 등 공식 원천) 자격증 + 연세 인증 유저가 직접 제보한 실데이터로
 * 대체한다(지원요소 실DB grounding, 백엔드 계약 app/api/certifications.py).
 * app/societies/page.tsx와 완전히 같은 신뢰 체계·톤·레이아웃을 따른다(둘 다
 * "큐레이션 vs 유저 제보" 크라우드소싱 패턴이라 구조를 그대로 재사용).
 *
 * GET /api/certifications는 인증이 필요 없다(공개 열람 - 자격증 마스터는
 * 개인정보가 아니라 공공 데이터). 그래서 검색 자체는 비로그인도 가능하고,
 * 제보 폼만 연세 인증 유저 전용으로 잠근다(societies와 동일한 인라인 전환
 * 방식 - 모달이 아니라 같은 자리에서 로그인/인증 유도 문구로 대체).
 *
 * 보안 경계(건드리지 않음): 연락처 필드는 폼에 없다(설계상 부재).
 * official_url은 safeLinkHref를 통과했을 때만 앵커로 렌더한다. verified가
 * false인 항목은 절대 "실존·공식" 배지를 달지 않는다(하드 요구사항 - 유저
 * 제보는 승인돼도 큐레이션 등급으로 격상되지 않는다).
 *
 * 신고 기능 관련 알려진 계약 공백: 백엔드 CertificationOut 스키마와
 * user_certification_repo.list_approved()가 문서 id를 응답에 채우지 않아,
 * 지금 검색 결과만으로는 유저 제보 항목을 신고할 방법이 없다(lib/api.ts의
 * CertificationOut.id 주석 참고 - 직접 백엔드 코드로 확인함). 여기서는 id가
 * 실제로 오는 경우에만 신고 버튼을 노출해 죽은 버튼을 만들지 않는다.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, EmptyState, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import {
  ApiError,
  getCertifications,
  reportCertification,
  submitCertification,
  type CertificationOut,
} from "@/lib/api";
import { safeLinkHref } from "@/lib/markdown";

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[92px] animate-pulse rounded-lg border border-rule bg-ink-800/70" />
      ))}
    </div>
  );
}

/** 422 detail 문자열로 원인을 구분한다 - societies/page.tsx의 mapSubmitError와
 * 동일한 느슨한 키워드 매칭(백엔드 문구가 바뀌어도 이 두 갈래만 맞으면 된다). */
function mapSubmitError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "로그인이 필요해요.";
    if (err.status === 403) return "연세 인증이 필요해요.";
    if (err.status === 409) return "이미 등록된 자격증입니다.";
    if (err.status === 429) return "잠시 후 다시 시도해 주세요.";
    if (err.status === 422) {
      if (/연락처|pii/i.test(err.detail)) {
        return "연락처는 담지 마세요. 이름·기관·공식 링크만 남겨주세요.";
      }
      if (/url|http|링크/i.test(err.detail)) {
        return "유효한 https 공식 링크만 넣어주세요.";
      }
      return err.detail || "입력을 확인해 주세요.";
    }
    return err.detail || "입력을 확인해 주세요.";
  }
  return "제보하지 못했어요. 잠시 후 다시 시도해주세요.";
}

function mapReportError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 400) return "검증된 자격증은 신고 대상이 아니에요.";
    if (err.status === 404) return "이미 처리된 제보예요.";
    if (err.status === 401) return "로그인이 필요해요.";
    if (err.status === 403) return "연세 인증이 필요해요.";
    if (err.status === 429) return "잠시 후 다시 시도해 주세요.";
  }
  return "신고하지 못했어요.";
}

/** 검증됨/미검증 배지 - Chip을 재사용하지 않고 직접 그린다. Chip의 톤 팔레트에는
 * "lit"(별빛 - 이 서비스에서 유일하게 허용되는 긍정 강조색, 초록 아님)이 없어서,
 * className 병합이 clsx가 아니라 단순 join(cn.ts)이라 우선순위를 보장 못 한다. */
function VerifiedBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-lit bg-lit/15 px-2.5 py-0.5 text-micro font-semibold text-text-hi">
        실존·공식
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-rule px-2.5 py-0.5 text-micro font-semibold text-text-lo">
      커뮤니티 제보 · 미검증
    </span>
  );
}

function CertCard({ cert }: { cert: CertificationOut }) {
  const href = safeLinkHref(cert.officialUrl);
  const [reportState, setReportState] = useState<"idle" | "sending" | "done">("idle");
  const [reportError, setReportError] = useState<string | null>(null);

  const metaBits = [cert.scope, cert.certClass, cert.tier].filter(Boolean);
  const scheduleEntries = cert.schedule ? Object.entries(cert.schedule) : [];

  async function handleReport() {
    if (!cert.id || reportState !== "idle") return;
    setReportState("sending");
    setReportError(null);
    try {
      await reportCertification(cert.id);
      setReportState("done");
    } catch (err) {
      setReportState("idle");
      setReportError(mapReportError(err));
    }
  }

  return (
    <div className="rounded-lg border border-rule bg-ink-800/70 p-4 backdrop-blur-[2px]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-sans text-body font-semibold text-text-hi">{cert.name}</h3>
        <VerifiedBadge verified={cert.verified} />
      </div>
      {(cert.issuer || metaBits.length > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-lo">
          {cert.issuer && <span>{cert.issuer}</span>}
          {cert.issuer && metaBits.length > 0 && <span aria-hidden>·</span>}
          {metaBits.length > 0 && <span>{metaBits.join(" · ")}</span>}
        </div>
      )}
      {scheduleEntries.length > 0 && (
        <p className="mt-2 text-caption text-text-lo">
          {scheduleEntries.map(([k, v]) => `${k} ${v}`).join(" · ")}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-body-sm font-semibold text-spec-b underline underline-offset-2 hover:text-text-hi"
          >
            공식 링크 ↗
          </a>
        )}
        {!cert.verified && cert.id && (
          <Button size="sm" variant="ghost" onClick={handleReport} disabled={reportState !== "idle"}>
            {reportState === "done" ? "신고 접수" : "신고"}
          </Button>
        )}
      </div>
      {reportError && <p className="mt-1.5 text-caption text-spec-m">{reportError}</p>}
    </div>
  );
}

const EMPTY_FORM = { name: "", issuer: "", officialUrl: "" };

export default function CertificationsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [certs, setCerts] = useState<CertificationOut[] | null>(null);
  const [certsError, setCertsError] = useState(false);
  const [searching, setSearching] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  async function runSearch(q: string) {
    setSearching(true);
    setCertsError(false);
    try {
      const list = await getCertifications(q.trim());
      setCerts(list);
    } catch {
      setCerts([]);
      setCertsError(true);
    } finally {
      setSearching(false);
    }
  }

  // 초기 진입 시 전체 목록을 보여준다 - GET은 인증 불요라 authLoading을 기다릴
  // 필요가 없다(societies와 달리 학과 드롭다운 같은 전제조건이 없음).
  useEffect(() => {
    runSearch("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearchSubmit() {
    if (searching) return;
    runSearch(query);
  }

  function openForm() {
    setSubmitError(null);
    setSubmitSuccess(false);
    setFormOpen((v) => !v);
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.issuer.trim() || !form.officialUrl.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitCertification({
        name: form.name.trim(),
        issuer: form.issuer.trim(),
        officialUrl: form.officialUrl.trim(),
      });
      setSubmitSuccess(true);
      setForm(EMPTY_FORM);
    } catch (err) {
      setSubmitError(mapSubmitError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="font-serif text-display font-bold text-text-hi">자격증</h1>
        <p className="text-body-sm text-text-lo">공식 등재 자격증 + 학생들이 직접 채운 자격증을 함께 찾아요</p>
      </header>

      <div className="flex gap-2">
        <Field
          id="cert-search"
          label="자격증 검색"
          placeholder="예: 정보처리기사"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearchSubmit();
          }}
          className="flex-1"
        />
        <div className="self-end">
          <Button onClick={handleSearchSubmit} disabled={searching}>
            검색
          </Button>
        </div>
      </div>

      <div className="mb-2.5 mt-6 flex items-center justify-between gap-3">
        <span className="font-mono text-caption tracking-[0.14em] text-text-lo">
          {query.trim() ? `"${query.trim()}" 검색 결과` : "전체 자격증"}
        </span>
        <Button size="sm" variant="secondary" onClick={openForm}>
          제보하기
        </Button>
      </div>

      {certs === null ? (
        <ListSkeleton />
      ) : certs.length === 0 && !certsError ? (
        <EmptyState
          title="찾는 자격증이 없어요 — 직접 제보해 주세요"
          action={<Button onClick={openForm}>제보하기</Button>}
        />
      ) : certsError ? (
        <EmptyState title="목록을 불러오지 못했어요" description="잠시 후 다시 시도해주세요" />
      ) : (
        <div className="flex flex-col gap-2.5">
          {certs.map((c) => (
            <CertCard key={c.id ?? c.jmcd ?? c.nameNorm} cert={c} />
          ))}
        </div>
      )}

      {formOpen && (
        <div className="mt-4 rounded-lg border border-rule bg-ink-800/70 p-4">
          <h2 className="font-sans text-body font-semibold text-text-hi">자격증 제보</h2>

          {authLoading ? (
            <div className="mt-3 h-9 w-40 animate-pulse rounded-sm bg-ink-700" />
          ) : !user ? (
            <div className="mt-3 flex flex-col items-start gap-2">
              <p className="text-body-sm text-text-lo">로그인하면 제보할 수 있어요</p>
              <Button onClick={() => router.push(`/login?next=${encodeURIComponent("/certifications")}`)}>
                로그인
              </Button>
            </div>
          ) : !user.yonseiVerified ? (
            <div className="mt-3 flex flex-col items-start gap-2">
              <p className="text-body-sm text-text-lo">연세대 학부생 인증을 마치면 제보할 수 있어요</p>
              <Link
                href="/verify"
                className="text-body-sm font-semibold text-spec-b underline underline-offset-2 hover:text-text-hi"
              >
                인증하러 가기
              </Link>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-3.5">
              <Field
                id="cert-name"
                label="자격증 이름"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={100}
              />
              <Field
                id="cert-issuer"
                label="발급 기관"
                value={form.issuer}
                onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))}
                maxLength={100}
              />
              <Field
                id="cert-url"
                label="공식 링크"
                type="url"
                placeholder="https://..."
                value={form.officialUrl}
                onChange={(e) => setForm((f) => ({ ...f, officialUrl: e.target.value }))}
                maxLength={500}
              />
              <p className="text-micro text-text-lo">
                연락처는 적지 마세요. 이름·기관·공식 링크(https)만 남겨주세요.
              </p>
              {submitError && <p className="text-caption text-spec-m">{submitError}</p>}
              {submitSuccess && <p className="text-caption text-spec-b">제보 접수 — 검토 후 공개돼요</p>}
              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={handleSubmit}
                  disabled={submitting || !form.name.trim() || !form.issuer.trim() || !form.officialUrl.trim()}
                >
                  {submitting ? "제보하는 중…" : "제보하기"}
                </Button>
                <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={submitting}>
                  닫기
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
