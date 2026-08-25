import type { Metadata, Viewport } from "next";
import { Gowun_Batang, IBM_Plex_Sans_KR } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

const gowun = Gowun_Batang({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-gowun" });
const plex = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "OurCompass — 콩나무 로드맵",
  description: "목표를 심으면 콩나무가 자라는 로드맵 SNS",
};

export const viewport: Viewport = {
  themeColor: "#06120A",
  viewportFit: "cover", // required for env(safe-area-inset-bottom)
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className={`${gowun.variable} ${plex.variable} font-sans antialiased`}>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
