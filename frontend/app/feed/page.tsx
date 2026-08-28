/*
 * 좌측 레일 "소셜" 항목의 목적지. 로그인 여부와 무관하게 항상 피드를 보여준다 -
 * 발행된 별자리는 공개 데이터이므로("로그인 하든 안 하든 플로우대로 움직이게,
 * 제한은 저장 시점" 방침) 익명 방문자도 이 경로로 들어오면 랜딩이 아니라 실제
 * 피드를 본다. app/page.tsx("/")는 비로그인일 때 여전히 TelescopeLanding을
 * 보여주지만("/"의 첫인상은 랜딩으로 유지), 이 페이지는 그 분기가 없다.
 * 좌측 레일(AppShell/SideRail)은 app/layout.tsx가 모든 라우트에 자동으로
 * 씌우므로 여기서 따로 감쌀 필요가 없다.
 */

import { FeedView } from "@/components/FeedView";

export default function FeedPage() {
  return <FeedView />;
}
