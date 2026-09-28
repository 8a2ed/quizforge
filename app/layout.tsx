import type { Metadata, Viewport } from "next";
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: "#080b11",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Alexandria:wght@300;400;500;600;700;800&family=Cairo:wght@400;500;600;700;800&family=Outfit:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <meta name="theme-color" content="#080b11" />
        <meta name="color-scheme" content="dark" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var savedDir = localStorage.getItem('quizforge_dir');
                  var savedLang = localStorage.getItem('quizforge_lang');
                  if (savedDir) {
                    document.documentElement.setAttribute('dir', savedDir);
                  }
                  if (savedLang) {
                    document.documentElement.setAttribute('lang', savedLang);
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
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
