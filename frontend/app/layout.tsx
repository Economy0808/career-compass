import type { Metadata, Viewport } from "next";
import { Gowun_Batang, IBM_Plex_Mono, IBM_Plex_Sans_KR } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

// Display: 별자리 이름 · 페이지 제목 전용 (UI chrome에는 사용 금지).
const gowun = Gowun_Batang({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-gowun" });
// Body/UI: 한글·라틴 모두 소화하는 본문 서체.
const plex = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex",
});
// Data: 학정번호(BIZ2101 등)·학점 숫자 전용 고정폭 서체.
const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "OurLab — 별자리 로드맵",
  description: "목표를 별자리로 그려나가는 커리어 로드맵 SNS",
};

export const viewport: Viewport = {
  themeColor: "#0B0E1A",
  viewportFit: "cover", // required for env(safe-area-inset-bottom)
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${gowun.variable} ${plex.variable} ${plexMono.variable} font-sans antialiased`}>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
