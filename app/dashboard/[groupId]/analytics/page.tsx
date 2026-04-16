"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from "recharts";

interface Analytics {
  summary: {
    totalQuizzes: number;
    totalAnswers: number;
    overallCorrectRate: number;
    quizTypes: Array<{ type: string; _count: { id: number } }>;
  };
  byTopic: Array<{ topicName: string | null; topicId: number | null; _count: { id: number } }>;
  bySender: Array<{ sentById: string; _count: { id: number }; user: { firstName: string; username: string | null; photoUrl: string | null } | null }>;
  activityData: Array<{ date: string; count: number }>;
  topTopics: Array<{ topicName: string | null; topicId: number | null; _count: { answers: number } }>;
}

const COLORS = ["#4f7fff", "#a78bfa", "#34d399", "#fbbf24", "#f87171", "#38bdf8"];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--clr-bg-elevated)",
      border: "1px solid var(--clr-border)",
      borderRadius: "var(--radius-md)",
      padding: "var(--space-3) var(--space-4)",
      fontSize: "0.85rem",
    }}>
      <div style={{ color: "var(--clr-text-muted)", marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: "var(--clr-text-primary)", fontWeight: 600 }}>
          {p.name && <span style={{ color: "var(--clr-text-muted)" }}>{p.name}: </span>}
          {p.value}
        </div>
      ))}
    </div>
  );
};

export default function AnalyticsPage() {
  const params = useParams();
  const groupId = params.groupId as string;
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/groups/${groupId}/analytics`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [groupId]);

  if (loading) {
    return (
      <div>
        <div className="section-header animate-fade-up">
          <h1>Analytics</h1>
        </div>
        <div className="grid grid-cols-4 gap-4" style={{ marginBottom: "var(--space-8)" }}>
          {[1,2,3,4].map((i) => <div key={i} className="skeleton" style={{ height: 100, borderRadius: "var(--radius-lg)" }} />)}
        </div>
        <div className="grid grid-cols-2 gap-6">
          {[1,2,3,4].map((i) => <div key={i} className="skeleton" style={{ height: 280, borderRadius: "var(--radius-lg)" }} />)}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const quizCount = data.summary.quizTypes.find(t => t.type === "QUIZ")?._count.id || 0;
  const pollCount = data.summary.quizTypes.find(t => t.type === "POLL")?._count.id || 0;
  const pieData = [
    { name: "Quizzes", value: quizCount },
    { name: "Polls", value: pollCount },
  ].filter(d => d.value > 0);

  const topicChartData = data.byTopic.slice(0, 8).map((t) => ({
    name: t.topicName || "General",
    count: t._count.id,
  }));

  const senderChartData = data.bySender.slice(0, 6).map((s) => ({
    name: s.user ? (s.user.username ? `@${s.user.username}` : s.user.firstName) : "Unknown",
    count: s._count.id,
  }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-8)" }}>
      <div className="section-header animate-fade-up">
        <div>
          <h1>Analytics</h1>
          <p>Insights across all quizzes for this group</p>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4 animate-fade-up animate-delay-1">
        {[
          {
            label: "Total Quizzes",
            value: data.summary.totalQuizzes,
            icon: "🎯",
            cls: "brand",
          },
          {
            label: "Total Responses",
            value: data.summary.totalAnswers,
            icon: "📝",
            cls: "accent",
          },
          {
            label: "Overall Correct Rate",
            value: `${data.summary.overallCorrectRate}%`,
            icon: "✅",
            cls: "success",
          },
          {
            label: "Active Topics",
            value: data.byTopic.length,
            icon: "📂",
            cls: "warning",
          },
        ].map((card) => (
          <div key={card.label} className={`stat-card ${card.cls}`}>
            <div className={`stat-icon ${card.cls}`} style={{ fontSize: "1.5rem" }}>
              {card.icon}
            </div>
            <div className="stat-info">
              <div className="stat-value">{card.value}</div>
              <div className="stat-label">{card.label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-2 gap-6 animate-fade-up animate-delay-2">

        {/* Activity Over Time */}
        <div className="card">
          <h3 style={{ marginBottom: "var(--space-5)" }}>Quizzes Over Time (30 days)</h3>
          {data.activityData.length === 0 ? (
            <div className="empty-state" style={{ padding: "var(--space-10)" }}>
              <p>No activity in the last 30 days</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={data.activityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: "var(--clr-text-muted)", fontSize: 11 }}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis tick={{ fill: "var(--clr-text-muted)", fontSize: 11 }} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="count"
                  name="Quizzes"
                  stroke="#4f7fff"
                  strokeWidth={2.5}
                  dot={{ fill: "#4f7fff", r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Type Distribution */}
        <div className="card">
          <h3 style={{ marginBottom: "var(--space-5)" }}>Quiz vs Poll Distribution</h3>
          {pieData.length === 0 ? (
            <div className="empty-state" style={{ padding: "var(--space-10)" }}>
              <p>No data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={4}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  formatter={(value) => <span style={{ color: "var(--clr-text-secondary)", fontSize: "0.875rem" }}>{value}</span>}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-2 gap-6 animate-fade-up animate-delay-3">

        {/* By Topic */}
        <div className="card">
          <h3 style={{ marginBottom: "var(--space-5)" }}>Quizzes by Topic</h3>
          {topicChartData.length === 0 ? (
            <div className="empty-state" style={{ padding: "var(--space-10)" }}>
              <p>No topic data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topicChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" tick={{ fill: "var(--clr-text-muted)", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "var(--clr-text-muted)", fontSize: 11 }}
                  width={90}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Quizzes" fill="#a78bfa" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By Sender */}
        <div className="card">
          <h3 style={{ marginBottom: "var(--space-5)" }}>Top Quiz Senders</h3>
          {senderChartData.length === 0 ? (
            <div className="empty-state" style={{ padding: "var(--space-10)" }}>
              <p>No sender data yet</p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={senderChartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis type="number" tick={{ fill: "var(--clr-text-muted)", fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fill: "var(--clr-text-muted)", fontSize: 11 }}
                  width={90}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Quizzes sent" fill="#34d399" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Sender table */}
      {data.bySender.length > 0 && (
        <div className="card animate-fade-up animate-delay-4">
          <h3 style={{ marginBottom: "var(--space-5)" }}>Admin Leaderboard</h3>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Admin</th>
                  <th>Quizzes Sent</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.bySender.map((sender, idx) => (
                  <tr key={sender.sentById}>
                    <td>
                      <span style={{
                        width: 24, height: 24, borderRadius: "50%",
                        background: idx === 0 ? "#fbbf24" : idx === 1 ? "#9ca3af" : idx === 2 ? "#f59e0b" : "var(--clr-bg-hover)",
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.75rem", fontWeight: 700,
                        color: idx < 3 ? "#0a0d14" : "var(--clr-text-muted)"
                      }}>
                        {idx + 1}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="avatar sm">
                          {sender.user?.photoUrl ? (
                            <img src={sender.user.photoUrl} alt="" />
                          ) : (
                            sender.user?.firstName?.charAt(0) || "?"
                          )}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{sender.user?.firstName || "Unknown"}</div>
                          {sender.user?.username && (
                            <div style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>@{sender.user.username}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontWeight: 700, fontSize: "1.1rem" }}>{sender._count.id}</td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ flex: 1, height: 6, background: "var(--clr-bg-hover)", borderRadius: "var(--radius-full)", overflow: "hidden" }}>
                          <div style={{
                            width: `${(sender._count.id / data.summary.totalQuizzes) * 100}%`,
                            height: "100%",
                            background: COLORS[idx % COLORS.length],
                            borderRadius: "var(--radius-full)",
                          }} />
                        </div>
                        <span style={{ fontSize: "0.85rem", fontWeight: 600, minWidth: 40 }}>
                          {Math.round((sender._count.id / data.summary.totalQuizzes) * 100)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
