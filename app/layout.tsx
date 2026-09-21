import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    template: "%s | QuizForge",
    default: "QuizForge — Telegram Quiz Dashboard",
  },
  description:
    "Create, send and analyze Telegram quizzes and polls from a powerful dashboard. Multi-group, multi-admin, with real-time analytics.",
  keywords: ["telegram", "quiz", "poll", "dashboard", "bot", "analytics"],
  openGraph: {
    type: "website",
    title: "QuizForge — Telegram Quiz Dashboard",
    description: "Create and send Telegram quizzes with analytics powered by your bot.",
    siteName: "QuizForge",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="auto" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <meta name="theme-color" content="#080b11" />
        <meta name="color-scheme" content="dark" />
      </head>
      <body suppressHydrationWarning>
        {/* Telegram Mini App SDK — loaded before any client JS */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        {children}
      </body>
    </html>
  );
}
