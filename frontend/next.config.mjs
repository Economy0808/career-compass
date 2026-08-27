/** @type {import('next').NextConfig} */
const nextConfig = {
  // Two dev servers (ports 3000/3001, separate Claude sessions) sharing one
  // .next dir corrupt each other's chunks (recurring 500/404 on _next/static).
  // Give the secondary server its own build dir via NEXT_DIST_DIR.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;

// Cloudflare Workers 로컬 개발(`next dev`)에서 Cloudflare 바인딩을 흉내내려면
// 필요. 배포 빌드에는 영향 없음 — OpenNext CLI가 별도로 번들링한다.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
