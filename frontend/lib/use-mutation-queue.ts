/**
 * 서버 뮤테이션 직렬 큐.
 *
 * 별자리 편집 화면은 로컬 state를 진실로 삼고 서버 호출은 "fire-and-forget"으로
 * 흘려보낸다(응답으로 state를 덮어쓰지 않음). 하지만 순서는 반드시 보장해야
 * 한다 - 예를 들어 노드를 막 드롭한 직후 바로 드래그하면 POST(생성)가 그
 * 노드의 PATCH(위치)보다 먼저 서버에 도착해야 한다. Promise.then으로 체이닝된
 * 큐 하나에 모든 뮤테이션을 태워 보내면, 각 호출이 끝난 뒤에야 다음 호출이
 * 나가므로 이 순서가 항상 지켜진다.
 *
 * 에러는 여기서 삼킨다(체인이 끊기면 안 되므로) - 실패한 뮤테이션 뒤에 줄 선
 * 다른 뮤테이션들이 취소되지 않고 계속 나가야 한다. 대신 console.error로
 * 남기고, 필요하면 onError로 UI(저장 상태 표시 등)에 알린다.
 */
export interface MutationQueue {
  enqueue: (fn: () => Promise<unknown>) => void;
}

export function createMutationQueue(onError?: (error: unknown) => void): MutationQueue {
  let queue: Promise<unknown> = Promise.resolve();

  function enqueue(fn: () => Promise<unknown>): void {
    queue = queue.then(fn).catch((error) => {
      console.error("[mutation-queue] 뮤테이션 실패", error);
      onError?.(error);
    });
  }

  return { enqueue };
}
