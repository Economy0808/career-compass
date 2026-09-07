"use client";

/*
 * 학회/동아리 크라우드소싱 디렉터리 - 인테이크가 LLM으로 지어내던 학회 정보를
 * 연세 인증 유저가 직접 제보한 실데이터로 대체한다(지원요소 실DB grounding
 * §1, 백엔드 계약 03-code-78/a5).
 *
 * 2026-09-07 1차 축을 학과 드롭다운 -> 분야 드롭다운으로 전환(사용자 지시:
 * 학회 분류가 수업 taxonomy의 학과 목록과 뒤섞여 있던 걸 학회 전용 분야로
 * 분리). SOCIETY_CATEGORIES(lib/api.ts, 14개 고정값)는 하드코딩 상수라
 * lib/courses-api.ts의 getCourseTaxonomy·온보딩 학과 프리필 의존을 더 이상
 * 쓰지 않는다 - 로그인 여부와 무관하게 항상 뜬다.
 *
 * 제보 폼은 연세 인증 유저 전용. 로그인 여부·인증 여부에 따라 폼 자리에
 * 안내문을 대신 보여준다(모달이 아니라 같은 자리에서 인라인 전환 - 사용자
 * 지시: "CTA that opens/reveals the submit form").
 *
 * 보안 경계(건드리지 않음): 연락처/담당자 필드는 폼에 없다(설계상 부재).
 * official_url은 safeLinkHref를 통과했을 때만 앵커로 렌더한다.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Chip, EmptyState, Field } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";
import {
  ApiError,
  getSocieties,
  submitSociety,
  SOCIETY_CATEGORIES,
  type SocietyCategory,
  type SocietyKind,
  type SocietyOut,
} from "@/lib/api";
import { safeLinkHref } from "@/lib/markdown";

const KIND_TONE: Record<SocietyKind, "goal" | "growth"> = {
  학회: "goal",
  동아리: "growth",
};

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-hidden>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-[92px] animate-pulse rounded-lg border border-rule bg-ink-800/70" />
      ))}
    </div>
  );
}

function SocietyCard({ society }: { society: SocietyOut }) {
  const href = safeLinkHref(society.official_url);
  return (
    <div className="rounded-lg border border-rule bg-ink-800/70 p-4 backdrop-blur-[2px]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-sans text-body font-semibold text-text-hi">{society.name}</h3>
        <Chip tone={KIND_TONE[society.kind]} size="sm" selected>
          {society.kind}
        </Chip>
      </div>
      {(society.field || society.recruit_season) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-text-lo">
          {society.field && <span>{society.field}</span>}
          {society.field && society.recruit_season && <span aria-hidden>·</span>}
          {society.recruit_season && <span>모집 {society.recruit_season}</span>}
        </div>
      )}
      {society.description && (
        <p className="mt-2 whitespace-pre-wrap text-body-sm leading-relaxed text-text-lo">
          {society.description}
        </p>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2.5 inline-block text-body-sm font-semibold text-spec-b underline underline-offset-2 hover:text-text-hi"
        >
          공식 링크 ↗
        </a>
      )}
    </div>
  );
}

/** 422 detail 문자열로 원인을 구분한다 - 백엔드 문구가 바뀌어도 이 두 갈래
 * 키워드만 맞으면 되게 느슨하게 매칭한다(app/services/pii_guard.py의
 * "연락처" 문구, app/schemas/societies.py의 "https 공식 링크" 문구). */
function mapSubmitError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "로그인이 필요해요.";
    if (err.status === 403) return "연세 인증이 필요해요.";
    if (err.status === 429) return "잠시 후 다시 시도해 주세요.";
    if (err.status === 422) {
      if (/연락처|pii/i.test(err.detail)) {
        return "담당자 연락처는 담지 마세요. 공식 링크만 남겨주세요.";
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

const EMPTY_FORM = { name: "", officialUrl: "", recruitSeason: "", fieldText: "", description: "" };

export default function SocietiesPage() {
  const { user } = useAuth();
  const router = useRouter();

  const [category, setCategory] = useState<SocietyCategory | "">("");

  const [societies, setSocieties] = useState<SocietyOut[] | null>(null);
  const [societiesError, setSocietiesError] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<SocietyKind>("학회");
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  // 분야가 정해지면 승인된 목록을 조회한다. 인증 불요.
  useEffect(() => {
    if (!category) {
      setSocieties(null);
      return;
    }
    let cancelled = false;
    setSocieties(null);
    setSocietiesError(false);
    getSocieties(category)
      .then((list) => {
        if (!cancelled) setSocieties(list);
      })
      .catch(() => {
        if (!cancelled) {
          setSocieties([]);
          setSocietiesError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [category]);

  function openForm() {
    setSubmitError(null);
    setSubmitSuccess(false);
    setFormOpen(true);
  }

  async function handleSubmit() {
    if (!category || !form.name.trim() || !form.officialUrl.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await submitSociety({
        category,
        name: form.name.trim(),
        kind,
        official_url: form.officialUrl.trim(),
        recruit_season: form.recruitSeason.trim() || undefined,
        field: form.fieldText.trim() || undefined,
        description: form.description.trim() || undefined,
      });
      setSubmitSuccess(true);
      setForm(EMPTY_FORM);
      setKind("학회");
    } catch (err) {
      setSubmitError(mapSubmitError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      <header className="mb-6 flex flex-col gap-1.5">
        <h1 className="font-serif text-display font-bold text-text-hi">학회 · 동아리</h1>
        <p className="text-body-sm text-text-lo">분야별 실제 학회·동아리 정보를 학생들이 직접 채워요</p>
      </header>

      <select
        value={category}
        onChange={(e) => setCategory(e.target.value as SocietyCategory | "")}
        aria-label="분야 선택"
        className="w-full rounded-md border border-rule bg-ink-900/60 px-3.5 py-2.5 text-body text-text-hi focus:outline-none focus-visible:border-spec-b"
      >
        <option value="">분야를 선택하세요</option>
        {SOCIETY_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {category && (
        <>
          <div className="mb-2.5 mt-6 flex items-center justify-between gap-3">
            <span className="font-mono text-caption tracking-[0.14em] text-text-lo">{category}</span>
            <Button size="sm" variant="secondary" onClick={openForm}>
              제보하기
            </Button>
          </div>

          {societies === null ? (
            <ListSkeleton />
          ) : societies.length === 0 && !societiesError ? (
            <EmptyState
              title="아직 등록된 학회가 없어요 — 첫 제보자가 되어주세요"
              action={<Button onClick={openForm}>제보하기</Button>}
            />
          ) : societiesError ? (
            <EmptyState title="목록을 불러오지 못했어요" description="잠시 후 다시 시도해주세요" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {societies.map((s) => (
                <SocietyCard key={s.id} society={s} />
              ))}
            </div>
          )}

          {formOpen && (
            <div className="mt-4 rounded-lg border border-rule bg-ink-800/70 p-4">
              <h2 className="font-sans text-body font-semibold text-text-hi">학회 · 동아리 제보</h2>

              {!user ? (
                <div className="mt-3 flex flex-col items-start gap-2">
                  <p className="text-body-sm text-text-lo">로그인하면 제보할 수 있어요</p>
                  <Button onClick={() => router.push(`/login?next=${encodeURIComponent("/societies")}`)}>
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
                  <p className="text-caption text-text-lo">
                    분야 <span className="font-semibold text-text-hi">{category}</span>
                  </p>
                  <Field
                    id="society-name"
                    label="이름"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    maxLength={100}
                  />
                  <div>
                    <p className="mb-1.5 text-caption font-semibold text-text-lo">구분</p>
                    <div className="flex gap-2">
                      {(["학회", "동아리"] as const).map((k) => (
                        <Chip key={k} tone={KIND_TONE[k]} selected={kind === k} interactive onClick={() => setKind(k)}>
                          {k}
                        </Chip>
                      ))}
                    </div>
                  </div>
                  <Field
                    id="society-url"
                    label="공식 링크"
                    type="url"
                    placeholder="https://..."
                    value={form.officialUrl}
                    onChange={(e) => setForm((f) => ({ ...f, officialUrl: e.target.value }))}
                    maxLength={500}
                  />
                  <Field
                    id="society-season"
                    label="모집 시기 (선택)"
                    placeholder="예: 매 학기 초"
                    value={form.recruitSeason}
                    onChange={(e) => setForm((f) => ({ ...f, recruitSeason: e.target.value }))}
                    maxLength={200}
                  />
                  <Field
                    id="society-field"
                    label="세부 분야 (선택)"
                    value={form.fieldText}
                    onChange={(e) => setForm((f) => ({ ...f, fieldText: e.target.value }))}
                    maxLength={200}
                  />
                  <Field
                    id="society-description"
                    label="설명 (선택)"
                    multiline
                    rows={4}
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    maxLength={2000}
                  />
                  <p className="text-micro text-text-lo">
                    담당자 연락처는 적지 마세요. 공식 링크(https)만 남겨주세요.
                  </p>
                  {submitError && <p className="text-caption text-spec-m">{submitError}</p>}
                  {submitSuccess && <p className="text-caption text-spec-b">제보 접수 — 검토 후 공개돼요</p>}
                  <div className="flex gap-2">
                    <Button
                      className="flex-1"
                      onClick={handleSubmit}
                      disabled={submitting || !form.name.trim() || !form.officialUrl.trim()}
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
        </>
      )}
    </div>
  );
}
