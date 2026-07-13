import type { Metadata } from "next";
import localFont from "next/font/local";
import { TopNav } from "@/components/TopNav";
import { UserProvider } from "@/lib/user-context";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "로드맵 | Career Compass",
  description: "목표를 말하면 AI가 마일스톤 로드맵을 만들어주는 동행 서비스",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <UserProvider>
          <TopNav />
          <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">{children}</main>
        </UserProvider>
      </body>
    </html>
  );
}
