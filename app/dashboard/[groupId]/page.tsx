"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { relativeTime } from "@/lib/utils";

interface GroupOverview {
  group: { id: string; title: string; chatId: string; isForum: boolean },
  recentQuizzes: Array<{
    id: string;
    question: string;
    type: string;
    sentAt: string;
    _count: { answers: number };
    correctRate: number | null;
    sentBy: { firstName: string; username: string | null };
  }>;
  stats: {
    totalQuizzes: number;
    totalAnswers: number;
    overallCorrectRate: number;
    thisWeek: number;
  };
}

export default function GroupOverviewPage() {
  const params = useParams();
  const groupId = params.groupId as string;
  const [data, setData] = useState<GroupOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`/api/groups/${groupId}/history?limit=5`).then((r) => r.json()),
      fetch(`/api/groups/${groupId}/analytics`).then((r) => r.json()),
    ]).then(([hist, analytics]) => {
      setData({
        group: { id: groupId, title: "Group", chatId: "", isForum: false },
        recentQuizzes: hist.quizzes || [],
        stats: {
          totalQuizzes: analytics.summary?.totalQuizzes || 0,
          totalAnswers: analytics.summary?.totalAnswers || 0,
          overallCorrectRate: analytics.summary?.overallCorrectRate || 0,
          thisWeek: analytics.activityData?.slice(-7).reduce((sum: number, d: { count: number }) => sum + d.count, 0) || 0,
        },
      });
      setLoading(false);
    });
  }, [groupId]);

  const quickActions = [
    { label: "Create Quiz", href: `/dashboard/${groupId}/quiz/new`, icon: "🎯", desc: "Send a new quiz or poll" },
    { label: "View History", href: `/dashboard/${groupId}/history`, icon: "📋", desc: "Browse all sent quizzes" },
    { label: "Analytics", href: `/dashboard/${groupId}/analytics`, icon: "📊", desc: "Detailed performance insights" },
    { label: "Manage Admins", href: `/dashboard/${groupId}/admins`, icon: "👥", desc: "Control who has access" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      {/* Page header */}
      <div className="animate-fade-up">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", marginBottom: "var(--space-2)" }}>
          <h1>Group Overview</h1>
        </div>
        <p>Your quiz activity at a glance</p>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map((i) => <div key={i} className="skeleton" style={{ height: 90, borderRadius: "var(--radius-lg)" }} />)}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-4 animate-fade-up animate-delay-1">
          <div className="stat-card brand">
            <div className="stat-icon brand">🎯</div>
            <div className="stat-info">
              <div className="stat-value">{data!.stats.totalQuizzes}</div>
              <div className="stat-label">Total Quizzes</div>
            </div>
          </div>
          <div className="stat-card accent">
            <div className="stat-icon accent">📝</div>
            <div className="stat-info">
              <div className="stat-value">{data!.stats.totalAnswers}</div>
              <div className="stat-label">Total Responses</div>
            </div>
          </div>
          <div className="stat-card success">
            <div className="stat-icon success">✅</div>
            <div className="stat-info">
              <div className="stat-value">{data!.stats.overallCorrectRate}%</div>
              <div className="stat-label">Correct Rate</div>
            </div>
          </div>
          <div className="stat-card warning">
            <div className="stat-icon warning">📅</div>
            <div className="stat-info">
              <div className="stat-value">{data!.stats.thisWeek}</div>
              <div className="stat-label">This Week</div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="animate-fade-up animate-delay-2">
        <h2 style={{ marginBottom: "var(--space-5)", fontSize: "1.1rem" }}>Quick Actions</h2>
        <div className="grid grid-cols-4 gap-4">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
                padding: "var(--space-5)",
                background: "var(--clr-bg-card)",
                border: "1px solid var(--clr-border)",
                borderRadius: "var(--radius-lg)",
                textDecoration: "none",
                transition: "all var(--duration-normal) var(--ease-out)",
              }}
              className="card"
            >
              <span style={{ fontSize: "1.75rem" }}>{action.icon}</span>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, marginBottom: 4 }}>{action.label}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)" }}>{action.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Quizzes */}
      <div className="animate-fade-up animate-delay-3">
        <div className="section-header">
          <h2 style={{ fontSize: "1.1rem" }}>Recent Quizzes</h2>
          <Link href={`/dashboard/${groupId}/history`} className="btn btn-ghost btn-sm">
            View all →
          </Link>
        </div>
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height: 70, borderRadius: "var(--radius-md)" }} />)}
          </div>
        ) : data?.recentQuizzes.length === 0 ? (
          <div className="empty-state" style={{ padding: "var(--space-12)" }}>
            <div className="empty-state-icon">📭</div>
            <h3>No quizzes yet</h3>
            <p>Create your first quiz to get started</p>
            <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-primary">
              Create Quiz
            </Link>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {data?.recentQuizzes.map((quiz) => (
              <div
                key={quiz.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-4)",
                  padding: "var(--space-4)",
                  background: "var(--clr-bg-card)",
                  border: "1px solid var(--clr-border)",
                  borderRadius: "var(--radius-md)",
                }}
              >
                <span style={{ fontSize: "1.5rem" }}>{quiz.type === "QUIZ" ? "🎯" : "📊"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    marginBottom: 2,
                  }}>
                    {quiz.question}
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
                    by {quiz.sentBy.firstName} · {relativeTime(quiz.sentAt)}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, color: "var(--clr-text-primary)" }}>{quiz._count.answers}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)" }}>responses</div>
                </div>
                {quiz.correctRate !== null && (
                  <div style={{
                    width: 52, height: 52, borderRadius: "50%",
                    background: `conic-gradient(${quiz.correctRate >= 70 ? "var(--clr-success)" : quiz.correctRate >= 40 ? "var(--clr-warning)" : "var(--clr-danger)"} ${quiz.correctRate * 3.6}deg, var(--clr-bg-elevated) 0deg)`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <div style={{
                      width: 38, height: 38, borderRadius: "50%",
                      background: "var(--clr-bg-card)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "0.7rem", fontWeight: 700,
                    }}>
                      {quiz.correctRate}%
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
