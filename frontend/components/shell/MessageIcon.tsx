"use client";

/**
 * DM(다이렉트 메시지) 우상단 아이콘 - components/shell/NotificationBell.tsx의
 * 관례를 그대로 따른다(우상단 fixed, 안읽음 뱃지, 바깥클릭/Escape로 닫힘, 포커스
 * 트랩, 비로그인 미렌더). 벨(right-4) 옆에 나란히 놓이도록 right-20에 둔다.
 *
 * - 경로별 배타(사용자 지시: "커뮤니티 제외한 일정, 탐색, 소셜 창"): 이 세 경로
 *   외에는 아이콘 자체를 렌더하지 않는다. 커뮤니티(/community*) 전용 "쪽지"
 *   아이콘은 다른 에이전트가 병행 제작 중이라 여기서는 그 자리를 비워 둔다 -
 *   AppShell이 이 컴포넌트를 무조건 마운트해도, 커뮤니티 경로에서는 이 컴포넌트가
 *   스스로 null을 반환해 자리표시자조차 그리지 않는다(메인 스레드가 나중에
 *   쪽지 아이콘 컴포넌트를 배선할 자리).
 * - 목록/대화 UI 본체는 components/DmPanel.tsx가 담당하고, 이 컴포넌트는 다이얼로그
 *   껍데기(제목줄·닫기·바깥클릭·포커스트랩)와 안읽음 뱃지만 소유한다.
 * - 넓은 화면(1440px 이상, AppShell의 w-rail 균형추와 같은 문턱)에서는 패널을
 *   화면 오른쪽 여백에 여백 없이 고정 도킹시키고(사용자 지시: "오른쪽 여백에"),
 *   그보다 좁은 화면에서는 알림함과 동일한 시트/팝오버 배치를 그대로 쓴다.
 *   w-rail(196px) 그대로는 대화 UI가 담기기엔 너무 좁아 실사용이 불가능해
 *   폭은 알림함과 같은 384px(w-96)을 유지하고 "여백에 붙는다"는 요구는 오른쪽
 *   가장자리에 틈 없이(md 이하의 right-4 간격과 달리) 붙이는 것으로 판단했다
 *   (판단 근거: 196px 챗 UI는 비현실적 - 보고서에 기록).
 */

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { DmPanel } from "@/components/DmPanel";
import { useAuth } from "@/lib/auth-context";
import { listDmThreads } from "@/lib/dm-api";

const DM_ROUTES = ["/explore", "/feed", "/schedule"];

function MessageBubbleIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="transparent"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 5.5h16v10H9.5L5.5 19V15.5H4Z" />
    </svg>
  );
}

export function MessageIcon() {
  const { user } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const isDmRoute =
    pathname !== null && DM_ROUTES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  // 마운트 시 1회 조회 - 뱃지만 채우면 충분, 폴링은 과설계(알림함과 동일 판단).
  useEffect(() => {
    if (!user || !isDmRoute) return;
    listDmThreads()
      .then((res) => setUnreadTotal(res.unreadTotal))
      .catch(() => {
        // ponytail: 뱃지 조회 실패는 조용히 무시 - 아이콘은 그냥 0으로 보인다
      });
  }, [user, isDmRoute]);

  // 바깥 pointerdown/Escape로 닫힘 - NotificationBell.tsx와 동일 패턴.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // 포커스 트랩 - NotificationBell.tsx와 동일한 경량 패턴(라이브러리 없음).
  useEffect(() => {
    if (!open) return;
    const root = panelRef.current;
    if (!root) return;
    const prevFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>('button, [href], textarea, [tabindex]:not([tabindex="-1"])'));
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
  }, [open]);

  if (!user || !isDmRoute) return null;

  return (
    <div ref={containerRef} className="contents">
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "메시지함 닫기" : "메시지함 열기"}
        onClick={() => setOpen((o) => !o)}
        className="paper-surface fixed right-20 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-paper-line bg-paper-soft/95 text-paper-ink shadow-panel backdrop-blur-md transition-colors hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-ink"
      >
        <MessageBubbleIcon />
        {unreadTotal > 0 && (
          <span
            aria-hidden
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-spec-b px-1 font-mono text-micro font-semibold leading-none text-paper"
          >
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="메시지함"
          className="paper-surface fixed inset-x-3 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+12px)] z-[100] flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-paper-line bg-paper-soft/95 shadow-panel backdrop-blur-md md:inset-x-auto md:bottom-auto md:right-4 md:top-[64px] md:w-96 md:max-h-[75vh] min-[1440px]:right-0 min-[1440px]:top-16 min-[1440px]:bottom-0 min-[1440px]:max-h-none min-[1440px]:rounded-r-none min-[1440px]:border-r-0"
        >
          <div className="flex items-center justify-between border-b border-paper-line px-4 py-3">
            <h2 className="font-serif text-body font-bold text-paper-ink">메시지</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="rounded-sm p-1 text-paper-lo transition-colors hover:text-paper-ink"
            >
              <span aria-hidden className="block text-body leading-none">
                ×
              </span>
            </button>
          </div>

          <DmPanel onUnreadTotalChange={setUnreadTotal} />
        </div>
      )}
    </div>
  );
}
