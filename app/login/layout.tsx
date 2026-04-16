import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login",
  description: "Sign in to QuizForge with your Telegram account.",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
