import type { Metadata } from "next";
import { Gowun_Batang, IBM_Plex_Sans_KR } from "next/font/google";
import { SideNav } from "@/components/SideNav";
import { UserProvider } from "@/lib/user-context";
import "./globals.css";

const gowun = Gowun_Batang({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-gowun",
});
const plex = IBM_Plex_Sans_KR({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-plex",
});

export const metadata: Metadata = {
  title: "Career Compass — 콩나무 로드맵",
  description: "목표를 심으면 콩나무가 자라는 로드맵 SNS",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${gowun.variable} ${plex.variable} font-sans antialiased`}>
        <UserProvider>
          <SideNav />
          {children}
        </UserProvider>
      </body>
    </html>
  );
}
