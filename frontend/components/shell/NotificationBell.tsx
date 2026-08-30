"use client";

/**
 * 별(✦) 알림함 - 우상단 고정 벨. 로드맵 발행 알림은 백엔드에 아예 없으므로
 * 여기서도 다루지 않는다(사용자 지시: "넣으면 사람들 안쓴다").
 *
 * - 아이콘: 이 리포에 이미 있는 좋아요 별(components/PostDetail.tsx의
 *   LikeStarIcon)을 그대로 재사용한다 - 항상 outline(filled=false)로 그리고,
 *   미읽음은 숫자 뱃지로만 신호한다(별 자체를 채우면 "내가 좋아요 누른 상태"
 *   어휘와 겹친다).
 * - 패널 열고 닫기: components/shell/NavIsland.tsx와 동일한 경량 패턴(바깥
 *   pointerdown + Escape로 닫힘, 라이브러리 없음) + components/StoryViewer.tsx와
 *   동일한 포커스 트랩. containerRef가 버튼+패널을 함께 감싸(display:contents라
 *   레이아웃에는 영향 없음) "바깥 클릭" 판정 기준이 되고, 모바일 시트 배경의
 *   딤(scrim)은 일부러 그 바깥에 형제로 둔다 - 그래야 딤을 눌러도 자연히
 *   "바깥 클릭"으로 잡혀 별도 onClick 없이 같은 리스너로 닫힌다.
 * - 읽음 처리: 개별 읽음 API가 없어 패널을 열 때마다 read-all을 호출하고
 *   로컬 unreadCount만 0으로 내린다(사용자 승인 스펙).
 * - 비로그인이면 벨 자체를 렌더하지 않는다(이 리포 1차 전환 패턴 - 로그인
 *   유도는 각 화면이 이미 담당).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { LikeStarIcon } from "@/components/PostDetail";
import { useAuth } from "@/lib/auth-context";
import { relativeTimeKo } from "@/lib/format";
import { requestOpenDm, requestOpenNotes } from "@/lib/message-panel-bus";
import {
  listNotifications,
  markAllNotificationsRead,
  type NotificationDto,
} from "@/lib/notifications-api";

// dm·note는 문구가 고정 템플릿("이름 + 접미사")에 안 맞아 렌더링에서 개별
// 분기한다(아래 items.map) - 여기 표는 follow/like/comment 세 개만 다룬다.
const TYPE_LABEL: Partial<Record<NotificationDto["type"], string>> = {
  follow: "회원님을 팔로우하기 시작했어요",
  like: "회원님의 게시물을 좋아합니다",
  comment: "회원님의 게시물에 댓글을 남겼어요",
};

function notificationHref(n: NotificationDto): string {
  if (n.type === "dm") return "/feed";
  if (n.type === "note") return "/community";
  if (n.type === "follow") return `/profile/${encodeURIComponent(n.actorUid ?? "")}`;
  return n.postId
    ? `/post/${encodeURIComponent(n.postId)}`
    : `/profile/${encodeURIComponent(n.actorUid ?? "")}`;
}

/** dm·note는 클릭 시 해당 경로로 이동한 뒤(Link의 기본 동작) 메시지 패널
 * 버스로 "그 상대와의 대화를 열어라" / "쪽지함을 열어라"를 알린다 - 두
 * 컴포넌트가 직접 호출할 수 없어 lib/message-panel-bus.ts를 거친다.
 * follow/like/comment는 기존 Link 이동 그대로 - 여기서 건드리지 않는다. */
function handleNotificationClick(n: NotificationDto) {
  if (n.type === "dm" && n.actorUid) {
    requestOpenDm(n.actorUid);
  } else if (n.type === "note") {
    requestOpenNotes();
  }
}

export function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 마운트 시 1회 조회 - unreadCount 뱃지만 채우면 충분, 폴링은 과설계(지시).
  useEffect(() => {
    if (!user) return;
    listNotifications()
      .then((res) => setUnreadCount(res.unreadCount))
      .catch(() => {
        // ponytail: 뱃지 조회 실패는 조용히 무시 - 벨은 그냥 0으로 보인다
      });
  }, [user]);

  // 패널을 열 때 재조회 + 일괄 읽음 처리(개별 읽음 API가 없다 - 승인된 스펙).
  useEffect(() => {
    if (!open) return;
    listNotifications()
      .then((res) => setItems(res.items))
      .catch(() => {
        // ponytail: 목록 조회 실패는 빈 상태로 표시 - 배너 없이 조용히
      });
    markAllNotificationsRead()
      .then(() => setUnreadCount(0))
      .catch(() => {
        // ponytail: 읽음 처리 실패해도 다음에 열 때 다시 시도되므로 무시
      });
  }, [open]);

  // 바깥 pointerdown/Escape로 닫힘 - NavIsland.tsx와 동일 패턴.
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

  // 포커스 트랩 - StoryViewer.tsx와 동일한 경량 패턴(라이브러리 없음).
  useEffect(() => {
    if (!open) return;
    const root = panelRef.current;
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
  }, [open]);

  if (!user) return null;

  return (
    <>
      {/* display:contents - 레이아웃에 박스를 남기지 않고 "바깥 클릭" 판정
          기준(ref)만 제공. 버튼과 패널이 여기 안에 함께 있어야 패널 내부
          클릭이 "바깥"으로 오판되지 않는다. */}
      <div ref={containerRef} className="contents">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "알림함 닫기" : "알림함 열기"}
          onClick={() => setOpen((o) => !o)}
          className="paper-surface fixed right-4 top-4 z-20 flex h-11 w-11 items-center justify-center rounded-full border border-paper-line bg-paper-soft/95 text-paper-ink shadow-panel backdrop-blur-md transition-colors hover:bg-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-paper-ink"
        >
          <LikeStarIcon filled={false} size={20} />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-spec-b px-1 font-mono text-micro font-semibold leading-none text-paper"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="알림함"
            className="paper-surface fixed inset-x-3 bottom-[calc(var(--tabbar-h)+var(--safe-bottom)+12px)] z-[100] flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-paper-line bg-paper-soft/95 shadow-panel backdrop-blur-md md:inset-x-auto md:bottom-auto md:right-4 md:top-[64px] md:w-96 md:max-h-[75vh]"
          >
            <div className="flex items-center justify-between border-b border-paper-line px-4 py-3">
              <h2 className="font-serif text-body font-bold text-paper-ink">알림</h2>
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

            <div className="overflow-y-auto">
              {items.length === 0 ? (
                <p className="px-4 py-10 text-center text-body-sm text-paper-lo">아직 새 소식이 없어요</p>
              ) : (
                items.map((n) => (
                  <Link
                    key={n.id}
                    href={notificationHref(n)}
                    onClick={() => {
                      setOpen(false);
                      handleNotificationClick(n);
                    }}
                    className="flex items-start gap-3 border-b border-paper-line px-4 py-3 no-underline transition-colors last:border-b-0 hover:bg-paper"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper text-lg">
                      {/* note는 actor 자체가 없어(익명성) 항상 기본 도상만 뜬다. */}
                      {n.actor?.avatarEmoji ?? "🔭"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-sm text-paper-ink">
                        {n.type === "note" ? (
                          "새 쪽지가 도착했어요"
                        ) : (
                          <>
                            <span className="font-semibold">{n.actor?.displayName ?? "관측자"}</span>
                            {n.type === "dm" ? "님이 메시지를 보냈어요" : <>{" "}{TYPE_LABEL[n.type]}</>}
                          </>
                        )}
                      </span>
                      <span className="mt-0.5 block text-caption text-paper-lo">
                        {relativeTimeKo(n.createdAt)}
                      </span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
