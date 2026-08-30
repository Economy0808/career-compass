"use client";

/**
 * 알림함(components/shell/NotificationBell.tsx)과 메시지 아이콘
 * (components/shell/MessageIcon.tsx)을 잇는 모듈 전역 pub/sub 버스.
 *
 * 두 컴포넌트는 서로 다른 트리 분기(AppShell)에서 마운트/언마운트를 오가서
 * 직접 호출할 수 없고, React Context를 새로 심는 것도 이 과제 범위 밖이라
 * components/CommunityNoteInbox.tsx 상단의 안읽음 스토어와 동일한 최소
 * pub/sub로 해결한다.
 *
 * 요청은 1회성이다 - 소비되는 즉시 비워진다. 알림 클릭 → 다른 경로로 이동 →
 * 그 경로에서 비로소 MessageIcon이 마운트되는 순서라("/", "/constellation*"
 * 같은 몰입/섬 크롬 경로에는 MessageIcon 자체가 없다 - AppShell.tsx 참고),
 * 구독자가 아직 없을 때 들어온 요청은 pending에 보류했다가 첫 구독자에게
 * 전달한다.
 */

export type MessagePanelRequest = { kind: "dm"; peerUid: string } | { kind: "notes" };

let pending: MessagePanelRequest | null = null;
const listeners = new Set<(req: MessagePanelRequest) => void>();

function dispatch(req: MessagePanelRequest) {
  if (listeners.size === 0) {
    pending = req;
    return;
  }
  listeners.forEach((fn) => fn(req));
}

/** 알림함이 dm 알림을 클릭했을 때 호출 - 그 상대와의 대화를 연다. */
export function requestOpenDm(peerUid: string): void {
  dispatch({ kind: "dm", peerUid });
}

/** 알림함이 note 알림을 클릭했을 때 호출 - 쪽지함을 연다(발신자는 절대 알 수 없다). */
export function requestOpenNotes(): void {
  dispatch({ kind: "notes" });
}

/** MessageIcon이 구독한다. 구독 시점에 보류된 요청이 있으면 즉시 전달하고 비운다. */
export function subscribeMessagePanel(fn: (req: MessagePanelRequest) => void): () => void {
  listeners.add(fn);
  if (pending) {
    const req = pending;
    pending = null;
    fn(req);
  }
  return () => {
    listeners.delete(fn);
  };
}
