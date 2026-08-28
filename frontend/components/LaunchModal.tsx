"use client";

/**
 * "별자리 띄우기" 모달 - 이름/상세/공개 여부/Contributor를 입력받아 발행까지
 * 한 번에 처리한다. 좌상단 저장 툴바의 titleModal(최초 저장)과는 별개 흐름 -
 * 여기서 "띄우기"를 누르면 아직 저장 전이어도 생성부터 발행까지 이 모달이
 * 전부 담당한다(page.tsx의 onLaunch 참고).
 *
 * 오버레이(bg-ink-900/50 + backdrop-blur-sm)는 관측 표면의 어둠을 그대로 쓰고,
 * 그 위에 뜨는 창 자체는 종이 크롬(.paper-surface + islandExpand)이다 -
 * "종이 성도" 은유를 지키면서도 모달 배경은 기존 회색조 오버레이 언어를 그대로 따른다.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { CloseIcon } from "@/components/ui/icons";

export interface LaunchInput {
  title: string;
  description: string;
  isPublished: boolean;
  contributors: string[];
}

export interface LaunchModalProps {
  open: boolean;
  onClose: () => void;
  isLoggedIn: boolean;
  defaultTitle: string;
  defaultDescription?: string;
  defaultIsPublished: boolean;
  defaultContributors: string[];
  onLaunch: (input: LaunchInput) => Promise<void>;
  onGoLogin: () => void;
}

const MAX_CONTRIBUTORS = 10;
const MAX_CONTRIBUTOR_LEN = 40;

export function LaunchModal({
  open,
  onClose,
  isLoggedIn,
  defaultTitle,
  defaultDescription,
  defaultIsPublished,
  defaultContributors,
  onLaunch,
  onGoLogin,
}: LaunchModalProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription ?? "");
  // "띄우기" 모달을 여는 의도 자체가 공개이므로 스위치는 항상 켜진 채 시작한다
  // (실사고: 기본 꺼짐이라 띄우기를 눌러도 비공개로 저장돼 "프로필에 안 떠요").
  // 내리고 싶을 때만 사용자가 스위치를 끈다. defaultIsPublished는 이제 표시용
  // 상태 칩(발행됨/비공개)에서만 쓰인다.
  const [isPublished, setIsPublished] = useState(true);
  const [contributors, setContributors] = useState<string[]>(defaultContributors);
  const [contributorInput, setContributorInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 열릴 때마다 최신 기본값(현재 제목/발행 상태 등)으로 되돌린다 - 이전에
  // 열었다 취소한 입력이 다음번에 남아있지 않게.
  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setDescription(defaultDescription ?? "");
    setIsPublished(true); // 위 초기값 주석 참고 - 띄우기 = 공개가 기본
    setContributors(defaultContributors);
    setContributorInput("");
    setError(null);
    setSubmitting(false);
  }, [open, defaultTitle, defaultDescription, defaultIsPublished, defaultContributors]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  function addContributor() {
    const name = contributorInput.trim().slice(0, MAX_CONTRIBUTOR_LEN);
    if (!name || contributors.length >= MAX_CONTRIBUTORS) return;
    setContributors((prev) => (prev.includes(name) ? prev : [...prev, name]));
    setContributorInput("");
  }

  function removeContributor(name: string) {
    setContributors((prev) => prev.filter((c) => c !== name));
  }

  async function handleLaunch() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onLaunch({ title: trimmedTitle, description: description.trim(), isPublished, contributors });
    } catch (err) {
      console.error("[constellation] 별자리 띄우기 실패", err);
      setError("띄우기에 실패했어요. 다시 시도해 주세요.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="별자리 띄우기"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="paper-surface w-full max-w-md animate-[islandExpand_220ms_cubic-bezier(.22,1,.36,1)] rounded-xl border border-paper-line bg-paper/95 p-5 shadow-overlay backdrop-blur-md"
      >
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="font-serif text-title font-bold text-paper-ink">별자리 띄우기</h2>
          <button
            type="button"
            aria-label="닫기"
            onClick={onClose}
            className="rounded p-1 text-paper-lo transition-colors hover:text-paper-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {!isLoggedIn ? (
          <div className="space-y-3">
            <p className="font-sans text-sm text-paper-lo">띄우려면 로그인이 필요해요.</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 font-sans text-sm text-paper-lo hover:text-paper-ink"
              >
                취소
              </button>
              <button
                type="button"
                onClick={onGoLogin}
                className="cta-ink rounded-md bg-paper-ink px-3 py-1.5 font-sans text-sm font-medium text-paper"
              >
                로그인하러 가기
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="font-sans text-xs font-medium text-paper-lo">이름</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 경영학 복수전공 로드맵"
                className="w-full rounded-md border border-paper-line bg-paper px-3 py-2 font-sans text-sm text-paper-ink placeholder:text-paper-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
              />
            </label>

            <label className="block space-y-1">
              <span className="font-sans text-xs font-medium text-paper-lo">상세 내용</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="이 별자리가 어떤 계획인지 짧게 소개해 주세요."
                className="w-full resize-none rounded-md border border-paper-line bg-paper px-3 py-2 font-sans text-sm text-paper-ink placeholder:text-paper-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink"
              />
            </label>

            <div className="flex items-center justify-between rounded-md border border-paper-line bg-paper-soft px-3 py-2">
              <span className="font-sans text-sm text-paper-ink">공개</span>
              <button
                type="button"
                role="switch"
                aria-checked={isPublished}
                onClick={() => setIsPublished((v) => !v)}
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink",
                  isPublished ? "bg-paper-ink" : "bg-paper-line"
                )}
              >
                <span
                  className={cn(
                    "absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-transform",
                    isPublished ? "translate-x-[22px]" : "translate-x-0.5"
                  )}
                />
              </button>
            </div>

            <div className="space-y-1.5">
              <span className="font-sans text-xs font-medium text-paper-lo">함께하는 친구 (Contributor)</span>
              {contributors.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {contributors.map((name) => (
                    <span
                      key={name}
                      className="flex items-center gap-1 rounded-full bg-paper-soft px-2.5 py-1 font-sans text-xs text-paper-ink"
                    >
                      {name}
                      <button
                        type="button"
                        aria-label={`${name} 삭제`}
                        onClick={() => removeContributor(name)}
                        className="text-paper-lo hover:text-paper-ink"
                      >
                        <CloseIcon size={10} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <input
                type="text"
                value={contributorInput}
                onChange={(e) => setContributorInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addContributor();
                  }
                }}
                disabled={contributors.length >= MAX_CONTRIBUTORS}
                placeholder={contributors.length >= MAX_CONTRIBUTORS ? "최대 10명" : "닉네임 입력 후 Enter"}
                maxLength={MAX_CONTRIBUTOR_LEN}
                className="w-full rounded-md border border-paper-line bg-paper px-3 py-2 font-sans text-sm text-paper-ink placeholder:text-paper-lo focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-paper-ink disabled:opacity-50"
              />
              <p className="font-sans text-[11px] text-paper-lo">공개 시 함께 표시돼요</p>
            </div>

            {error && <p className="font-sans text-xs text-spec-m">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-3 py-1.5 font-sans text-sm text-paper-lo hover:text-paper-ink"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleLaunch()}
                disabled={!title.trim() || submitting}
                className="cta-ink rounded-md bg-paper-ink px-4 py-1.5 font-sans text-sm font-medium text-paper disabled:cursor-not-allowed disabled:opacity-40"
              >
                {submitting ? "띄우는 중…" : "띄우기"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
