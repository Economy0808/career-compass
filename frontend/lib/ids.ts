/**
 * 클라이언트에서 생성하는 id 유틸.
 *
 * 노드/엣지/노트의 id는 서버가 채번하지 않고 클라이언트가 만들어 그대로
 * 서버에 실어 보낸다(낙관적 로컬 상태가 곧 진실이므로, 서버 응답을 기다렸다가
 * id를 되받는 왕복을 하지 않는다). crypto.randomUUID가 없는 아주 오래된
 * 환경(또는 비-HTTPS 컨텍스트)을 위해 Math.random 기반 fallback도 둔다 -
 * ElementNotesPanel.tsx의 makeAttachmentId와 같은 패턴이다.
 */
export function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
