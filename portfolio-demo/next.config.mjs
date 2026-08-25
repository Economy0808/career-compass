/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // GitHub Pages 프로젝트 사이트는 https://<user>.github.io/<repo>/ 경로에 뜬다.
  basePath: "/career-compass",
  assetPrefix: "/career-compass/",
  images: { unoptimized: true }, // 정적 export는 Next Image 최적화 서버가 없다.
  trailingSlash: true, // GitHub Pages는 디렉터리+index.html 방식이라 필요.
  // 정적 데모용 스텁 함수의 의도적 미사용 인자(_args 등)에 ESLint no-unused-vars가
  // 걸린다 — 데모 빌드를 막을 정도는 아니라 빌드 시 린트는 건너뛴다.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
