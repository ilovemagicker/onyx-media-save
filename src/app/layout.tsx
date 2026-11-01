import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "媒體下載 · Onyx Labs",
  description:
    "Onyx Labs 公開平台解析與網頁媒體挑選下載（僅公開內容、個人存檔）",
  icons: {
    icon: "/favicon.png",
  },
  openGraph: {
    title: "媒體下載 · Onyx Labs",
    description: "公開平台解析 · 任意網頁媒體挑選",
    siteName: "Onyx Labs",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-screen antialiased bg-canvas text-foreground">
        {children}
      </body>
    </html>
  );
}
