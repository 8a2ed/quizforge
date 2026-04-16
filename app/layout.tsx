import type { Metadata } from "next";
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
    <html lang="en" data-scroll-behavior="smooth">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
