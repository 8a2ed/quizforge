"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

const COLORS = ["#4f7fff","#a78bfa","#34d399","#fbbf24","#f87171","#38bdf8","#fb923c","#e879f9"];
const TT = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--clr-bg-elevated)", border: "1px solid var(--clr-border)", borderRadius: 8, padding: "8px 12px", fontSize: "0.83rem" }}>
      {label && <div style={{ color: "var(--clr-text-muted)", marginBottom: 2 }}>{label}</div>}
      {payload.map((p, i) => <div key={i} style={{ fontWeight: 600 }}>{p.name ? <span style={{ color: "var(--clr-text-muted)" }}>{p.name}: </span> : null}{p.value}</div>)}
    </div>
  );
};

interface AnalyticsData {
  summary: { totalQuizzes: number; totalAnswers: number; overallCorrectRate: number; quizTypes: { type: string; _count: { id: number } }[]; deletedCount: number; closedCount: number; activeCount: number };
  byTopic: { topicName: string | null; _count: { id: number } }[];
  bySender: { sentById: string; _count: { id: number }; user: { firstName: string; username: string | null } | null }[];
  activityData: { date: string; count: number }[];
  peakHours: { hour: number; label: string; count: number }[];
  hardestQuizzes: { id: string; question: string; total: number; correct: number; rate: number }[];
  easiestQuizzes: { id: string; question: string; total: number; correct: number; rate: number }[];
  topicDropoff: Record<string, { question: string; sentAt: string; answers: number }[]>;
  responseRateByTopic: { topic: string; quizCount: number; avgResponses: number }[];
}

export default function AnalyticsPage() {
  const { groupId } = useParams() as { groupId: string };
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [dropoffTopic, setDropoffTopic] = useState("");

  const load = (d: number) => {
    setLoading(true);
    fetch(`/api/groups/${groupId}/analytics?days=${d}`)
      .then(r => r.json()).then(d => { setData(d); setLoading(false); });
  };

  useEffect(() => { load(days); }, [groupId, days]);

  useEffect(() => {
    if (data && Object.keys(data.topicDropoff).length > 0 && !dropoffTopic) {
      setDropoffTopic(Object.keys(data.topicDropoff)[0]);
    }
  }, [data]);

  const StatCard = ({ label, value, icon, sub }: { label: string; value: string | number; icon: string; sub?: string }) => (
    <div className="card" style={{ padding: "var(--space-4)", display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
      <div style={{ fontSize: "1.8rem", width: 48, height: 48, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--radius-md)", background: "var(--clr-bg-elevated)", flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1 }}>{value}</div>
        <div style={{ fontSize: "0.75rem", color: "var(--clr-text-muted)", marginTop: 2 }}>{label}</div>
        {sub && <div style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );

  if (loading || !data) return (
    <div>
      <div className="section-header animate-fade-up"><h1>Analytics</h1></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: "var(--space-3)", marginBottom: "var(--space-6)" }}>
        {[1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{ height: 80, borderRadius: 12 }} />)}
      </div>
      {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 240, borderRadius: 12, marginBottom: 16 }} />)}
    </div>
  );

  const quizCount = data.summary.quizTypes.find(t => t.type === "QUIZ")?._count.id || 0;
  const pollCount = data.summary.quizTypes.find(t => t.type === "POLL")?._count.id || 0;
  const topicChartData = data.byTopic.slice(0, 8).map(t => ({ name: t.topicName || "General", count: t._count.id }));
  const senderData = data.bySender.slice(0, 6).map(s => ({ name: s.user ? (s.user.username ? `@${s.user.username}` : s.user.firstName) : "Unknown", count: s._count.id }));
  const dropoffData = dropoffTopic && data.topicDropoff[dropoffTopic] ? data.topicDropoff[dropoffTopic] : [];
  const maxDropoff = Math.max(...dropoffData.map(d => d.answers), 1);
  const dropoffIdx = dropoffData.reduce((worst, d, i) => {
    if (i === 0) return worst;
    const drop = dropoffData[i-1].answers - d.answers;
    return drop > (dropoffData[worst > 0 ? worst-1 : 0]?.answers - dropoffData[worst]?.answers || 0) ? i : worst;
  }, 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)" }}>
      {/* Header */}
      <div className="section-header animate-fade-up">
        <div><h1>Analytics</h1><p>Insights across all quizzes for this group</p></div>
        <div style={{ display: "flex", gap: 6 }}>
          {[7,30,90].map(d => (
            <button key={d} onClick={() => { setDays(d); load(d); }}
              className={`btn btn-sm ${days === d ? "btn-primary" : "btn-secondary"}`}>{d}d</button>
          ))}
        </div>
      </div>

      {/* Stat cards */}
      <div className="animate-fade-up animate-delay-1" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: "var(--space-3)" }}>
        <StatCard label="Total Quizzes" value={data.summary.totalQuizzes} icon="🎯" sub={`${quizCount} quiz · ${pollCount} poll`} />
        <StatCard label="Total Responses" value={data.summary.totalAnswers} icon="📝" />
        <StatCard label="Correct Rate" value={`${data.summary.overallCorrectRate}%`} icon="✅" />
        <StatCard label="Active" value={data.summary.activeCount} icon="🟢" />
        <StatCard label="Closed" value={data.summary.closedCount} icon="⏹" />
        <StatCard label="Deleted" value={data.summary.deletedCount} icon="🗑" />
      </div>

      {/* Activity + Peak Hours */}
      <div className="animate-fade-up animate-delay-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: "var(--space-4)" }}>
        <div className="card">
          <h3 style={{ marginBottom: "var(--space-4)", fontSize: "0.95rem" }}>📅 Activity ({days} days)</h3>
          {data.activityData.length === 0
            ? <div className="empty-state" style={{ padding: 40 }}><p>No activity</p></div>
            : <ResponsiveContainer width="100%" height={180}>
                <LineChart data={data.activityData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="date" tick={{ fill: "var(--clr-text-muted)", fontSize: 10 }} tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fill: "var(--clr-text-muted)", fontSize: 10 }} />
                  <Tooltip content={<TT />} />
                  <Line type="monotone" dataKey="count" name="Quizzes" stroke="#4f7fff" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
          }
        </div>
        <div className="card">
          <h3 style={{ marginBottom: "var(--space-4)", fontSize: "0.95rem" }}>🕐 Peak Hours (UTC)</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={data.peakHours}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="hour" tick={{ fill: "var(--clr-text-muted)", fontSize: 9 }} tickFormatter={h => `${h}h`} />
              <YAxis tick={{ fill: "var(--clr-text-muted)", fontSize: 10 }} />
              <Tooltip content={<TT />} />
              <Bar dataKey="count" name="Quizzes" radius={[3,3,0,0]}>
                {data.peakHours.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.8} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* By Topic + By Sender */}
      <div className="animate-fade-up animate-delay-2" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: "var(--space-4)" }}>
        <div className="card">
          <h3 style={{ marginBottom: "var(--space-4)", fontSize: "0.95rem" }}>📂 Quizzes by Topic</h3>
          {topicChartData.length === 0 ? <div className="empty-state" style={{ padding: 30 }}><p>No topics</p></div>
            : <ResponsiveContainer width="100%" height={200}>
                <BarChart data={topicChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" tick={{ fill: "var(--clr-text-muted)", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "var(--clr-text-muted)", fontSize: 10 }} width={80} />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="count" name="Quizzes" fill="#a78bfa" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
          }
        </div>
        <div className="card">
          <h3 style={{ marginBottom: "var(--space-4)", fontSize: "0.95rem" }}>👤 Top Senders</h3>
          {senderData.length === 0 ? <div className="empty-state" style={{ padding: 30 }}><p>No data</p></div>
            : <ResponsiveContainer width="100%" height={200}>
                <BarChart data={senderData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis type="number" tick={{ fill: "var(--clr-text-muted)", fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: "var(--clr-text-muted)", fontSize: 10 }} width={80} />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="count" name="Sent" fill="#34d399" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
          }
        </div>
      </div>

      {/* Hardest + Easiest */}
      {(data.hardestQuizzes.length > 0 || data.easiestQuizzes.length > 0) && (
        <div className="animate-fade-up animate-delay-3" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px,1fr))", gap: "var(--space-4)" }}>
          {[
            { title: "🔴 Hardest Questions", items: data.hardestQuizzes, color: "#f87171" },
            { title: "🟢 Easiest Questions", items: data.easiestQuizzes, color: "#34d399" },
          ].map(({ title, items, color }) => (
            <div key={title} className="card">
              <h3 style={{ marginBottom: "var(--space-4)", fontSize: "0.95rem" }}>{title}</h3>
              {items.length === 0 ? <p style={{ color: "var(--clr-text-muted)", fontSize: "0.85rem" }}>Not enough data yet (need ≥2 responses)</p>
                : items.map((q, i) => (
                  <div key={q.id} style={{ marginBottom: 10 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", marginBottom: 3 }}>
                      <span style={{ color: "var(--clr-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "75%" }}>
                        {i + 1}. {q.question}
                      </span>
                      <span style={{ fontWeight: 700, color, flexShrink: 0 }}>{q.rate}%</span>
                    </div>
                    <div style={{ height: 5, background: "var(--clr-bg-hover)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ width: `${q.rate}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.6s" }} />
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "var(--clr-text-muted)", marginTop: 2 }}>{q.correct}/{q.total} correct · {q.total} responses</div>
                  </div>
                ))
              }
            </div>
          ))}
        </div>
      )}

      {/* Drop-off Analysis */}
      {Object.keys(data.topicDropoff).length > 0 && (
        <div className="card animate-fade-up animate-delay-3">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)", flexWrap: "wrap", gap: "var(--space-3)" }}>
            <h3 style={{ margin: 0, fontSize: "0.95rem" }}>📉 Drop-off Analysis</h3>
            <select className="select" style={{ minWidth: 160 }} value={dropoffTopic} onChange={e => setDropoffTopic(e.target.value)}>
              {Object.keys(data.topicDropoff).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          {dropoffData.length < 2
            ? <p style={{ color: "var(--clr-text-muted)", fontSize: "0.85rem" }}>Need at least 2 quizzes in this topic to show drop-off.</p>
            : <>
                <p style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)", marginBottom: "var(--space-4)" }}>
                  Biggest drop-off: <strong style={{ color: "#f87171" }}>Question {dropoffIdx + 1}</strong> — responses dropped from {dropoffData[dropoffIdx - 1]?.answers} to {dropoffData[dropoffIdx]?.answers}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {dropoffData.map((d, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 22, height: 22, borderRadius: "50%", background: i === dropoffIdx ? "rgba(248,113,113,0.15)" : "var(--clr-bg-elevated)", border: `2px solid ${i === dropoffIdx ? "#f87171" : "var(--clr-border)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 700, flexShrink: 0, color: i === dropoffIdx ? "#f87171" : "var(--clr-text-muted)" }}>
                        {i + 1}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "0.78rem", color: "var(--clr-text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 3 }}>{d.question}</div>
                        <div style={{ height: 8, background: "var(--clr-bg-hover)", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ width: `${Math.round((d.answers / maxDropoff) * 100)}%`, height: "100%", background: i === dropoffIdx ? "#f87171" : "#4f7fff", borderRadius: 99, transition: "width 0.6s" }} />
                        </div>
                      </div>
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: i === dropoffIdx ? "#f87171" : "var(--clr-text-primary)", minWidth: 24, textAlign: "right" }}>{d.answers}</span>
                    </div>
                  ))}
                </div>
              </>
          }
        </div>
      )}

      {/* Response rate by topic */}
      {data.responseRateByTopic.length > 0 && (
        <div className="card animate-fade-up animate-delay-4">
          <h3 style={{ marginBottom: "var(--space-4)", fontSize: "0.95rem" }}>📊 Avg Responses per Quiz by Topic</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.responseRateByTopic.map((t, i) => {
              const max = Math.max(...data.responseRateByTopic.map(x => x.avgResponses), 1);
              return (
                <div key={t.topic} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: "0.8rem", color: "var(--clr-text-muted)", minWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.topic}</span>
                  <div style={{ flex: 1, height: 8, background: "var(--clr-bg-hover)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${Math.round((t.avgResponses / max) * 100)}%`, height: "100%", background: COLORS[i % COLORS.length], borderRadius: 99, transition: "width 0.6s" }} />
                  </div>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700, minWidth: 28, textAlign: "right" }}>{t.avgResponses}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Admin Leaderboard */}
      {data.bySender.length > 0 && (
        <div className="card animate-fade-up animate-delay-4">
          <h3 style={{ marginBottom: "var(--space-4)", fontSize: "0.95rem" }}>🏆 Admin Leaderboard</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {data.bySender.map((s, idx) => (
              <div key={s.sentById} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-md)", background: idx === 0 ? "rgba(251,191,36,0.06)" : "transparent" }}>
                <div style={{ width: 24, height: 24, borderRadius: "50%", background: idx === 0 ? "#fbbf24" : idx === 1 ? "#9ca3af" : idx === 2 ? "#f59e0b" : "var(--clr-bg-hover)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.7rem", fontWeight: 800, color: idx < 3 ? "#0a0d14" : "var(--clr-text-muted)", flexShrink: 0 }}>{idx + 1}</div>
                <div style={{ flex: 1, fontSize: "0.87rem", fontWeight: 600 }}>{s.user?.firstName || "Unknown"}{s.user?.username ? ` · @${s.user.username}` : ""}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 80, height: 6, background: "var(--clr-bg-hover)", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ width: `${Math.round((s._count.id / data.summary.totalQuizzes) * 100)}%`, height: "100%", background: COLORS[idx % COLORS.length], borderRadius: 99 }} />
                  </div>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, minWidth: 24 }}>{s._count.id}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
