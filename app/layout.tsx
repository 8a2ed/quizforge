import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Alexandria, Cairo, Inter, Outfit } from "next/font/google";
import "./globals.css";

const alexandria = Alexandria({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-alexandria",
});

const cairo = Cairo({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
  display: "swap",
  variable: "--font-cairo",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-inter",
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-outfit",
});

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
    <html
      lang="ar"
      dir="rtl"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${alexandria.variable} ${cairo.variable} ${inter.variable} ${outfit.variable}`}
    >
      <head>
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
        {/* Third-party Telegram WebApp script loaded after page interactive */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="afterInteractive"
        />
        {children}
      </body>
    </html>
  );
}
