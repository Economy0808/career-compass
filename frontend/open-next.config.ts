import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 이 앱은 서버 컴포넌트 revalidate/ISR을 쓰지 않는다(전 페이지가 클라이언트
// 사이드에서 fetch) — R2 증분 캐시 바인딩 없이 기본값으로 충분하다.
export default defineCloudflareConfig();
