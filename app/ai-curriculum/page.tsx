"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, ArrowRight, ShieldCheck, BookOpen } from "lucide-react";

interface Group {
  id: string;
  title: string;
  chatId: string;
}

export default function AiCurriculumEntryPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/groups")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (!data) return;
        const groupList = data.groups || [];
        setGroups(groupList);
        // If user has exactly one group, redirect immediately to that group's curriculum
        if (groupList.length === 1) {
          router.replace(`/dashboard/${groupList[0].id}/curriculum`);
          return;
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, [router]);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--clr-bg-base)",
          color: "#fff",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "var(--radius-lg)",
            background: "var(--grad-brand)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 32px var(--clr-brand-glow)",
          }}
        >
          <Sparkles size={28} />
        </div>
        <h3 style={{ margin: 0, fontWeight: 700 }}>جاري تحميل نظام توليد المناهج بالذكاء الاصطناعي...</h3>
        <span style={{ color: "var(--clr-text-secondary)", fontSize: "0.9rem" }}>
          QuizForge AI Zero-Hallucination Curriculum Engine
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "var(--clr-bg-base)",
      }}
    >
      <div className="card" style={{ width: "100%", maxWidth: 540, padding: 32, textAlign: "center" }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: "var(--radius-xl)",
            background: "var(--grad-brand)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 20px",
            boxShadow: "0 0 32px var(--clr-brand-glow)",
          }}
        >
          <Sparkles size={32} color="#fff" />
        </div>

        <h2 style={{ fontSize: "1.5rem", fontWeight: 800, marginBottom: 8 }}>
          نظام توليد الأسئلة والامتحانات من المناهج
        </h2>
        <p style={{ color: "var(--clr-text-secondary)", fontSize: "0.95rem", marginBottom: 24 }}>
          اختر المجموعة أو القناة الدراسية لفتح لوحة التحكم الخاصة بالمناهج والذكاء الاصطناعي:
        </p>

        {groups.length === 0 ? (
          <div>
            <p style={{ color: "var(--clr-warning)", marginBottom: 16 }}>
              لم تقم بإضافة أي مجموعة تليجرام بعد.
            </p>
            <Link href="/dashboard" className="btn btn-brand" style={{ width: "100%", justifyContent: "center" }}>
              الذهاب للوحة التحكم لإضافة مجموعة
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {groups.map((g) => (
              <Link
                key={g.id}
                href={`/dashboard/${g.id}/curriculum`}
                className="btn btn-ghost"
                style={{
                  justifyContent: "space-between",
                  padding: "14px 18px",
                  borderRadius: "var(--radius-md)",
                  border: "1px solid var(--clr-border)",
                  textAlign: "right",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <BookOpen size={18} color="var(--clr-brand)" />
                  <strong style={{ fontSize: "1rem" }}>{g.title}</strong>
                </div>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
