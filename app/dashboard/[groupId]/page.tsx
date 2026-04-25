"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { relativeTime } from "@/lib/utils";

interface Quiz {
  id: string;
  question: string;
  type: string;
  sentAt: string;
  _count: { answers: number };
  correctRate: number | null;
  sentBy: { firstName: string; username: string | null };
  topicName: string | null;
  pollClosed: boolean;
  deletedAt: string | null;
}

interface Stats {
  totalQuizzes: number;
  totalAnswers: number;
  overallCorrectRate: number;
  thisWeek: number;
  today: number;
}

export default function GroupOverviewPage() {
  const params = useParams();
  const groupId = params.groupId as string;

  const [groupTitle, setGroupTitle] = useState("Your Group");
  const [recentQuizzes, setRecentQuizzes] = useState<Quiz[]>([]);
  const [stats, setStats] = useState<Stats>({ totalQuizzes: 0, totalAnswers: 0, overallCorrectRate: 0, thisWeek: 0, today: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      fetch(`/api/groups/${groupId}/history?limit=5`).then((r) => r.json()),
      fetch(`/api/groups/${groupId}/analytics`).then((r) => r.json()),
    ]).then(([hist, analytics]) => {
      setRecentQuizzes(hist.quizzes || []);
      if (hist.groupTitle) setGroupTitle(hist.groupTitle);

      const today = (hist.quizzes || []).filter((q: Quiz) => {
        const d = new Date(q.sentAt);
        const now = new Date();
        return d.toDateString() === now.toDateString();
      }).length;

      setStats({
        totalQuizzes: analytics.summary?.totalQuizzes || 0,
        totalAnswers: analytics.summary?.totalAnswers || 0,
        overallCorrectRate: Math.round(analytics.summary?.overallCorrectRate || 0),
        thisWeek: analytics.activityData?.slice(-7).reduce((s: number, d: { count: number }) => s + d.count, 0) || 0,
        today,
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const quickActions = [
    { label: "Create Quiz", href: `/dashboard/${groupId}/quiz/new`, icon: "🎯", desc: "Send a new quiz or poll", color: "var(--clr-brand)" },
    { label: "Bulk Loader", href: `/dashboard/${groupId}/bulk`, icon: "📦", desc: "Upload multiple quizzes", color: "var(--clr-accent)" },
    { label: "History", href: `/dashboard/${groupId}/history`, icon: "📋", desc: "Browse all sent quizzes", color: "var(--clr-success)" },
    { label: "Analytics", href: `/dashboard/${groupId}/analytics`, icon: "📊", desc: "Performance insights", color: "var(--clr-warning)" },
    { label: "Topics", href: `/dashboard/${groupId}/topics`, icon: "💬", desc: "Manage forum topics", color: "#a78bfa" },
    { label: "Admins", href: `/dashboard/${groupId}/admins`, icon: "👥", desc: "Control who has access", color: "#38bdf8" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>

      {/* Hero banner */}
      <div className="overview-hero animate-fade-up">
        <div className="overview-hero-content">
          <div className="overview-hero-badge">📊 Dashboard</div>
          <h1 style={{ marginBottom: "var(--space-2)", fontSize: "clamp(1.5rem, 3vw, 2rem)" }}>
            {groupTitle}
          </h1>
          <p style={{ color: "rgba(255,255,255,0.65)", margin: 0 }}>
            Your quiz activity at a glance
          </p>
        </div>
        <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-primary" style={{ flexShrink: 0, alignSelf: "center" }}>
          + New Quiz
        </Link>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map((i) => <div key={i} className="skeleton" style={{ height: 90, borderRadius: "var(--radius-lg)" }} />)}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4 animate-fade-up animate-delay-1">
          <div className="stat-card brand">
            <div className="stat-icon brand">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            </div>
            <div className="stat-info">
              <div className="stat-value">{stats.totalQuizzes}</div>
              <div className="stat-label">Total Quizzes</div>
            </div>
          </div>
          <div className="stat-card accent">
            <div className="stat-icon accent">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
            </div>
            <div className="stat-info">
              <div className="stat-value">{stats.totalAnswers}</div>
              <div className="stat-label">Total Responses</div>
            </div>
          </div>
          <div className="stat-card success">
            <div className="stat-icon success">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            </div>
            <div className="stat-info">
              <div className="stat-value">{stats.overallCorrectRate}%</div>
              <div className="stat-label">Correct Rate</div>
            </div>
          </div>
          <div className="stat-card warning">
            <div className="stat-icon warning">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </div>
            <div className="stat-info">
              <div className="stat-value">{stats.thisWeek}</div>
              <div className="stat-label">This Week</div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="animate-fade-up animate-delay-2">
        <h2 style={{ marginBottom: "var(--space-5)", fontSize: "1.05rem", color: "var(--clr-text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700 }}>
          Quick Actions
        </h2>
        <div className="grid grid-cols-3 gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="quick-action-card"
              style={{ "--action-color": action.color } as React.CSSProperties}
            >
              <span className="quick-action-icon">{action.icon}</span>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, marginBottom: 2 }}>{action.label}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>{action.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Quizzes */}
      <div className="animate-fade-up animate-delay-3">
        <div className="section-header">
          <h2 style={{ fontSize: "1.05rem", color: "var(--clr-text-secondary)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, margin: 0 }}>
            Recent Activity
          </h2>
          <Link href={`/dashboard/${groupId}/history`} className="btn btn-ghost btn-sm">
            View all →
          </Link>
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 70, borderRadius: "var(--radius-md)" }} />)}
          </div>
        ) : recentQuizzes.length === 0 ? (
          <div className="empty-state" style={{ padding: "var(--space-12)" }}>
            <div className="empty-state-icon" style={{ fontSize: "2rem" }}>📭</div>
            <h3>No quizzes yet</h3>
            <p>Create your first quiz to get started</p>
            <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-primary">
              Create First Quiz
            </Link>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {recentQuizzes.map((quiz, idx) => (
              <Link
                key={quiz.id}
                href={`/dashboard/${groupId}/history`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-4)",
                  padding: "var(--space-4) var(--space-5)",
                  borderBottom: idx < recentQuizzes.length - 1 ? "1px solid var(--clr-border)" : "none",
                  textDecoration: "none",
                  transition: "background var(--duration-fast)",
                }}
                className="recent-quiz-row"
              >
                {/* Type icon */}
                <div style={{
                  width: 40, height: 40, borderRadius: "var(--radius-md)", flexShrink: 0,
                  background: quiz.type === "QUIZ" ? "var(--clr-brand-muted)" : "var(--clr-accent-muted)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "1.1rem",
                }}>
                  {quiz.type === "QUIZ" ? "🎯" : "📊"}
                </div>

                {/* Question */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2, fontSize: "0.9rem" }}>
                    {quiz.question}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                    <span>by {quiz.sentBy.firstName}</span>
                    {quiz.topicName && <><span>·</span><span>#{quiz.topicName}</span></>}
                    <span>·</span>
                    <span>{relativeTime(quiz.sentAt)}</span>
                    {quiz.deletedAt && <span style={{ color: "var(--clr-danger)" }}>· deleted</span>}
                    {quiz.pollClosed && !quiz.deletedAt && <span style={{ color: "var(--clr-text-muted)" }}>· closed</span>}
                  </div>
                </div>

                {/* Responses */}
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--clr-text-primary)" }}>{quiz._count.answers}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)" }}>responses</div>
                </div>

                {/* Correct rate donut */}
                {quiz.correctRate !== null && (
                  <div style={{
                    width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                    background: `conic-gradient(${quiz.correctRate >= 70 ? "var(--clr-success)" : quiz.correctRate >= 40 ? "var(--clr-warning)" : "var(--clr-danger)"} ${quiz.correctRate * 3.6}deg, var(--clr-bg-elevated) 0deg)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--clr-bg-card)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.62rem", fontWeight: 700 }}>
                      {quiz.correctRate}%
                    </div>
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
