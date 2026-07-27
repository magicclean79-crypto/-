import type { Metadata } from "next";
import { APP_NAME } from "@acos/shared";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "AI 기반 제품 콘텐츠 운영 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-zinc-50 text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
