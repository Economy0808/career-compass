/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;

// Cloudflare Workers 로컬 개발(`next dev`)에서 Cloudflare 바인딩을 흉내내려면
// 필요. 배포 빌드에는 영향 없음 — OpenNext CLI가 별도로 번들링한다.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
