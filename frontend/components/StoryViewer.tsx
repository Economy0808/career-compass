"use client";

/*
 * 스토리 뷰어 - 전체화면 오버레이. 화면 좌/우 절반 탭으로 이전/다음 스토리를
 * 넘기고, 현재 유저의 마지막 스토리에서 다음을 누르면 ring의 다음 유저로
 * 넘어간다(인스타 관례). 5초 자동 진행 - 진행 바는 CSS transition으로
 * 채우므로 prefers-reduced-motion 전역 kill switch(globals.css)가 즉시
 * 채움으로 자동 축소한다(이 컴포넌트에서 별도 media query 불필요).
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth-context";
import { relativeTimeKo } from "@/lib/format";
import {
  deleteStory,
  listUserStories,
  markStoryViewed,
  type StoryDto,
  type StoryRingEntryDto,
} from "@/lib/stories-api";
import { Button, CloseIcon } from "@/components/ui";
import { VerifyGate, isVerifyRequiredError } from "@/components/VerifyGate";

const AUTO_ADVANCE_MS = 5000;

export interface StoryViewerProps {
  /** 링 넘김에 쓰는 전체 유저 목록(StoryRing이 onOpen과 함께 넘겨준 것 그대로). */
  ring: StoryRingEntryDto[];
  startUid: string;
  onClose: () => void;
}

export function StoryViewer({ ring, startUid, onClose }: StoryViewerProps) {
  const { user } = useAuth();
  const [uid, setUid] = useState(startUid);
  const [stories, setStories] = useState<StoryDto[] | null>(null);
  const [index, setIndex] = useState(0);
  const [filled, setFilled] = useState(false);
  const [verifyGateOpen, setVerifyGateOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const userIdx = ring.findIndex((r) => r.uid === uid);

  function goToUser(nextUid: string | undefined) {
    if (!nextUid) {
      onClose();
      return;
    }
    setUid(nextUid);
    setIndex(0);
  }

  function next() {
    if (stories && index < stories.length - 1) {
      setIndex(index + 1);
    } else {
      goToUser(ring[userIdx + 1]?.uid);
    }
  }

  function prev() {
    if (index > 0) setIndex(index - 1);
  }

  // uid가 바뀔 때마다 그 유저의 활성 스토리를 다시 불러온다.
  useEffect(() => {
    let cancelled = false;
    setStories(null);
    listUserStories(uid)
      .then((list) => {
        if (cancelled) return;
        if (list.length === 0) {
          goToUser(ring[userIdx + 1]?.uid);
          return;
        }
        setStories(list);
      })
      .catch(() => {
        if (!cancelled) goToUser(ring[userIdx + 1]?.uid);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ring/userIdx는 uid로부터 파생, 재실행 불필요
  }, [uid]);

  const current = stories?.[index];

  // 스토리가 화면에 뜰 때마다 열람 기록(실패 무시) + 진행 바 리셋 + 자동 진행 타이머.
  useEffect(() => {
    if (!current) return;
    setFilled(false);
    markStoryViewed(current.id).catch(() => {});
    const fillFrame = requestAnimationFrame(() => setFilled(true));
    const timer = setTimeout(next, AUTO_ADVANCE_MS);
    return () => {
      cancelAnimationFrame(fillFrame);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- next()는 최신 stories/index를 매 렌더 새로 캡처
  }, [current?.id]);

  // 키 핸들러가 effect 재구독 없이 최신 next/prev를 쓰기 위한 ref.
  const navRef = useRef({ next, prev });
  navRef.current = { next, prev };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") navRef.current.prev();
      else if (e.key === "ArrowRight") navRef.current.next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 포커스 트랩 - z-[70] 뒤의 레일/탭바로 Tab이 새지 않게 다이얼로그 안에서
  // 순환시키고, 닫힐 때 이전 포커스를 복원한다(ElementNotesPanel 오버레이와
  // 동일한 경량 패턴 - 라이브러리 없음).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>('button, [href], [tabindex]:not([tabindex="-1"])'));
    focusables()[0]?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const list = focusables();
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      prevFocus?.focus();
    };
  }, []);

  async function handleDelete() {
    if (!current) return;
    try {
      await deleteStory(current.id);
    } catch (err) {
      if (isVerifyRequiredError(err)) {
        setVerifyGateOpen(true);
        return;
      }
      // ponytail: 그 외 실패는 다음으로 넘어간다 - 별도 에러 배너는 과함
    }
    next();
  }

  const entry = ring[userIdx];

  return (
    <div ref={rootRef} className="fixed inset-0 z-[70] flex flex-col bg-ink-900" role="dialog" aria-modal="true">
      {/* 진행 바 */}
      <div className="flex gap-1 p-2.5 pt-3">
        {(stories ?? []).map((s, i) => (
          <div key={s.id} className="h-0.5 flex-1 overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full bg-text-hi transition-[width] duration-[5000ms] ease-linear"
              style={{ width: i < index ? "100%" : i === index && filled ? "100%" : "0%" }}
            />
          </div>
        ))}
      </div>

      {/* 상단 정보 줄 */}
      <div className="flex items-center gap-2.5 px-3.5 pb-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-ink-800 text-lg">
          {entry?.avatarEmoji ?? "🔭"}
        </span>
        <span className="font-sans text-body-sm font-medium text-text-hi">
          {entry?.displayName ?? "관측자"}
        </span>
        {current && (
          <span className="font-sans text-caption text-text-lo">{relativeTimeKo(current.createdAt)}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {current && user?.uid === current.ownerId && (
            <Button variant="ghost" size="sm" onClick={() => void handleDelete()}>
              삭제
            </Button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-sm p-1.5 text-text-lo transition-colors hover:text-text-hi"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* 이미지 + 좌/우 탭 영역 */}
      <div className="relative flex-1">
        {current && (
          // eslint-disable-next-line @next/next/no-img-element -- data URL은 next/image 최적화 대상이 아니다
          <img
            src={current.imageData}
            alt="스토리"
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
        <button type="button" aria-label="이전 스토리" onClick={prev} className={cn("absolute inset-y-0 left-0 w-1/2")} />
        <button type="button" aria-label="다음 스토리" onClick={next} className={cn("absolute inset-y-0 right-0 w-1/2")} />
      </div>
      <VerifyGate open={verifyGateOpen} onClose={() => setVerifyGateOpen(false)} />
    </div>
  );
}
