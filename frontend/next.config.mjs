/** @type {import('next').NextConfig} */
const nextConfig = {
  // Two dev servers (ports 3000/3001, separate Claude sessions) sharing one
  // .next dir corrupt each other's chunks (recurring 500/404 on _next/static).
  // Give the secondary server its own build dir via NEXT_DIST_DIR.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cloud Run 배포용: 런타임에 필요한 파일만 추린 standalone 번들을 만든다.
  // 이게 없으면 컨테이너에 node_modules 전체를 넣어야 해서 이미지가 커진다.
  output: "standalone",
};

export default nextConfig;

// Cloudflare Workers 로컬 개발(`next dev`)에서 Cloudflare 바인딩을 흉내내려면
// 필요. 배포 빌드에는 영향 없음 — OpenNext CLI가 별도로 번들링한다.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
