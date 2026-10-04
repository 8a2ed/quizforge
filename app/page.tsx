"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Compass, Home, User, Star, Moon, CheckCircle2, BookHeart, LayoutDashboard } from "lucide-react";
import { useDirection } from "@/lib/useDirection";

export default function HomePage() {
  const { isRtl: clientRtl } = useDirection();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const isRtl = isMounted ? clientRtl : true;

  return (
    <div style={{ 
      minHeight: "100vh", 
      position: "relative", 
      overflow: "hidden",
      backgroundColor: "var(--clr-bg-base)",
      color: "var(--clr-text-primary)"
    }}>
      
      {/* Background Decor */}
      <div style={{
        position: "absolute", top: "-10%", left: "50%", transform: "translateX(-50%)", width: "100%", height: "50vh",
        background: "radial-gradient(circle, rgba(16, 185, 129, 0.12) 0%, transparent 60%)",
        pointerEvents: "none", zIndex: 0
      }} />
      <div style={{
        position: "absolute", bottom: "-10%", right: "-10%", width: "50vw", height: "50vw",
        background: "radial-gradient(circle, rgba(16, 185, 129, 0.05) 0%, transparent 60%)",
        pointerEvents: "none", zIndex: 0
      }} />
      
      {/* Top Header */}
      <header style={{ 
        position: "relative", zIndex: 10,
        display: "flex", justifyContent: "space-between", alignItems: "center", 
        padding: "var(--space-4) var(--space-6)", maxWidth: "1280px", margin: "0 auto"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <div style={{ 
            width: 40, height: 40, borderRadius: "50%", background: "rgba(16, 185, 129, 0.1)", 
            display: "flex", alignItems: "center", justifyContent: "center", color: "var(--clr-success)"
          }}>
            <Moon size={22} />
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: "1.4rem", letterSpacing: "0.5px" }}>
            QuizForge
          </span>
        </div>
        <Link href="/login" className="btn btn-ghost btn-sm" style={{ color: "var(--clr-success)", fontWeight: 600 }}>
          {isRtl ? "تسجيل الدخول" : "Login"}
        </Link>
      </header>

      <main className="container" style={{ 
        position: "relative", zIndex: 1, 
        display: "flex", flexDirection: "column", gap: "var(--space-16)", 
        paddingTop: "var(--space-8)", paddingBottom: "120px" 
      }}>
        
        {/* Hero Section */}
        <section style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-5)" }}>
          <div className="badge badge-success" style={{ padding: "8px 16px", fontSize: "0.85rem", gap: "8px" }}>
            <Star size={14} fill="currentColor" /> 
            {isRtl ? "مرحباً بك في مسار المعرفة" : "Welcome to the path of knowledge"}
          </div>
          
          <h1 style={{ fontSize: "clamp(2.5rem, 6vw, 4rem)", lineHeight: 1.15, maxWidth: "900px", textShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
            {isRtl ? "ارتقِ بمعرفتك الإسلامية بأسلوب " : "Elevate your Islamic knowledge in a "}
            <span style={{ 
              color: "var(--clr-success)", 
              background: "linear-gradient(135deg, #34d399 0%, #10b981 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text"
            }}>
              {isRtl ? "عصري" : "modern"}
            </span>
            {isRtl ? " ومبتكر" : " and innovative way"}
          </h1>
          
          <p style={{ maxWidth: "600px", fontSize: "1.1rem", color: "var(--clr-text-secondary)", lineHeight: 1.7 }}>
            {isRtl 
              ? "منصة متطورة لاختبار وتنمية معرفتك في القرآن الكريم، السيرة النبوية، الفقه، والتاريخ الإسلامي بتجربة مستخدم لا مثيل لها."
              : "An advanced platform to test and grow your knowledge in Quran, Seerah, Fiqh, and Islamic History with an unparalleled user experience."}
          </p>
          
          <div style={{ display: "flex", gap: "var(--space-4)", marginTop: "var(--space-2)", flexWrap: "wrap", justifyContent: "center" }}>
            <Link href="/login" className="btn btn-primary btn-lg" style={{ 
              background: "var(--clr-success)", 
              boxShadow: "0 8px 24px -4px rgba(16, 185, 129, 0.5)", 
              border: "none",
              color: "#000",
              fontWeight: 700
            }}>
              {isRtl ? "ابدأ رحلتك الآن" : "Start Your Journey"}
            </Link>
            <Link href="/dashboard" className="btn btn-secondary btn-lg" style={{
              background: "rgba(16, 185, 129, 0.05)",
              borderColor: "rgba(16, 185, 129, 0.2)",
              color: "var(--clr-success)"
            }}>
              <LayoutDashboard size={18} style={{ marginInlineEnd: 8 }} />
              {isRtl ? "لوحة التحكم" : "Dashboard"}
            </Link>
          </div>
        </section>

        {/* Features / Cards Grid */}
        <section>
          <div style={{ textAlign: "center", marginBottom: "var(--space-8)" }}>
            <h2 style={{ fontSize: "1.8rem", color: "var(--clr-text-primary)" }}>
              {isRtl ? "اكتشف مجالات التعلم" : "Discover Learning Areas"}
            </h2>
            <div style={{ width: "40px", height: "4px", background: "var(--clr-success)", margin: "16px auto", borderRadius: "2px" }} />
          </div>

          <div style={{
            display: "grid", 
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", 
            gap: "var(--space-6)"
          }}>
            {[
              { icon: BookOpen, title: isRtl ? "القرآن الكريم" : "Holy Quran", desc: isRtl ? "اختبر حفظك وفهمك لآيات كتاب الله بصورة تفاعلية" : "Test your memorization & understanding of the verses." },
              { icon: BookHeart, title: isRtl ? "السيرة النبوية" : "Prophetic Seerah", desc: isRtl ? "رحلة ممتعة في حياة النبي ﷺ وأصحابه الكرام" : "An engaging journey through the Prophet's life." },
              { icon: Compass, title: isRtl ? "الفقه والعقيدة" : "Fiqh & Aqeedah", desc: isRtl ? "تعلم أحكام دينك الأساسية بطريقة مبسطة" : "Learn the fundamental rulings of your religion simply." },
              { icon: CheckCircle2, title: isRtl ? "التاريخ الإسلامي" : "Islamic History", desc: isRtl ? "تعرف على الأحداث والشخصيات التي غيرت مجرى العالم" : "Learn about events & figures that shaped the world." },
            ].map((feature, i) => (
              <div key={i} className="card" style={{ 
                display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", 
                gap: "var(--space-4)", padding: "var(--space-6)",
                background: "rgba(16, 185, 129, 0.03)",
                borderColor: "rgba(16, 185, 129, 0.1)",
                transition: "transform 0.3s ease, box-shadow 0.3s ease",
                cursor: "default"
              }}>
                <div style={{ 
                  width: 64, height: 64, borderRadius: "50%", 
                  background: "linear-gradient(135deg, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.05) 100%)", 
                  color: "var(--clr-success)", display: "flex", alignItems: "center", justifyContent: "center",
                  boxShadow: "inset 0 0 0 1px rgba(16, 185, 129, 0.2)"
                }}>
                  <feature.icon size={32} />
                </div>
                <h3 style={{ fontSize: "1.2rem", margin: 0, fontWeight: 700 }}>{feature.title}</h3>
                <p style={{ fontSize: "0.9rem", margin: 0, color: "var(--clr-text-secondary)", lineHeight: 1.6 }}>{feature.desc}</p>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Bottom Navigation Bar */}
      <nav className="bottom-tab-bar">
        {[
          { icon: Home, label: isRtl ? "الرئيسية" : "Home", active: true },
          { icon: Compass, label: isRtl ? "اكتشف" : "Discover", active: false },
          { icon: BookOpen, label: isRtl ? "مكتبتي" : "Library", active: false },
          { icon: User, label: isRtl ? "حسابي" : "Profile", active: false },
        ].map((item, i) => (
          <Link href={item.active ? "/" : "/dashboard"} key={i} className={`bottom-tab-item ${item.active ? "active" : ""}`} style={item.active ? { color: "var(--clr-success)" } : {}}>
            <div style={{ 
              position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 40, height: 30
            }}>
              {item.active && (
                <div style={{
                  position: "absolute", top: -14, width: 24, height: 4, 
                  background: "var(--clr-success)", borderRadius: "0 0 4px 4px",
                  boxShadow: "0 2px 8px rgba(16, 185, 129, 0.5)"
                }} />
              )}
              <item.icon size={24} style={{ strokeWidth: item.active ? 2.5 : 2 }} />
            </div>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
      
    </div>
  );
}
