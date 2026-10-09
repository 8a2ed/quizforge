"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDirection } from "../../lib/useDirection";

function Icon({ path }: { path: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  home:        "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  quiz:        "M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
  history:     "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  bulk:        "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4",
  analytics:   "M18 20V10M12 20V4M6 20v-6",
  topics:      "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
  admins:      "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  instructors: "M15 7a4 4 0 11-8 0 4 4 0 018 0zM3 20a9 9 0 0118 0H3z",
  settings:    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  groups:      "M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z",
  logout:      "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  library:     "M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 014 17V5a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H6.5",
  scheduled:   "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  exams:       "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  messages:    "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6",
  sparkles:    "M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ firstName: string; username?: string; photoUrl?: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { isRtl, toggleDirection } = useDirection();

  // Extract groupId from path — e.g. /dashboard/abc123/history → abc123
  // Exclude 'instructors' which is a top-level route under /dashboard
  const match = pathname.match(/\/dashboard\/([^/]+)/)?.[1];
  const groupId = match === "instructors" ? undefined : match;

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    document.body.classList.toggle("sidebar-open", mobileOpen);
    return () => document.body.classList.remove("sidebar-open");
  }, [mobileOpen]);

  // Close sidebar on route change
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => d.user && setUser(d.user))
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  const initials = user
    ? user.firstName.charAt(0).toUpperCase() + (user.firstName.split(" ")[1]?.charAt(0).toUpperCase() || "")
    : "?";

  // Sidebar nav items (organized by domain) with bilingual labels
  const navSections = groupId
    ? [
        {
          label: isRtl ? "لوحة التحكم" : "Dashboard",
          items: [
            { href: `/dashboard/${groupId}`,          icon: ICONS.home,     label: isRtl ? "نظرة عامة" : "Overview" },
            { href: `/dashboard/${groupId}/quiz/new`, icon: ICONS.quiz,     label: isRtl ? "إنشاء كويز" : "Create Quiz" },
            { href: `/dashboard/${groupId}/bulk`,     icon: ICONS.bulk,     label: isRtl ? "استيراد مجمع" : "Bulk Import" },
          ],
        },
        {
          label: isRtl ? "التقييمات والمحتوى" : "Assessments & Content",
          items: [
            { href: `/dashboard/${groupId}/curriculum`, icon: ICONS.sparkles, label: isRtl ? "توليد المناهج بالذكاء الاصطناعي" : "AI Curriculum" },
            { href: `/dashboard/${groupId}/exams`,     icon: ICONS.exams,     label: isRtl ? "الاختبارات" : "Exams" },
            { href: `/dashboard/${groupId}/library`,   icon: ICONS.library,   label: isRtl ? "بنك الأسئلة" : "Library" },
            { href: `/dashboard/${groupId}/history`,   icon: ICONS.history,   label: isRtl ? "سجل الكويزات" : "History" },
            { href: `/dashboard/${groupId}/scheduled`, icon: ICONS.scheduled, label: isRtl ? "المجدولة" : "Scheduled" },
            { href: `/dashboard/${groupId}/messages`,  icon: ICONS.messages,  label: isRtl ? "الرسائل" : "Messages" },
          ],
        },
        {
          label: isRtl ? "الإدارة والتحليلات" : "Management & Insights",
          items: [
            { href: `/dashboard/${groupId}/analytics`, icon: ICONS.analytics, label: isRtl ? "التحليلات" : "Analytics" },
            { href: `/dashboard/${groupId}/topics`,    icon: ICONS.topics,    label: isRtl ? "المواضيع والتوبيكس" : "Topics" },
            { href: `/dashboard/${groupId}/admins`,    icon: ICONS.admins,    label: isRtl ? "المشرفين" : "Admins" },
            { href: `/dashboard/${groupId}/settings`,  icon: ICONS.settings,  label: isRtl ? "الإعدادات" : "Settings" },
          ],
        },
      ]
    : [
        {
          label: isRtl ? "التنقل الأساسي" : "Navigation",
          items: [
            { href: "/dashboard",             icon: ICONS.groups,      label: isRtl ? "مجموعاتي" : "My Groups" },
            { href: "/dashboard/instructors", icon: ICONS.instructors, label: isRtl ? "المعلمين" : "Instructors" },
          ],
        },
      ];

  // Bottom tab items
  const bottomTabs = groupId
    ? [
        { href: `/dashboard/${groupId}`,          icon: ICONS.home,    label: isRtl ? "الرئيسية" : "Overview" },
        { href: `/dashboard/${groupId}/quiz/new`, icon: ICONS.quiz,    label: isRtl ? "إنشاء" : "Create"   },
        { href: `/dashboard/${groupId}/exams`,    icon: ICONS.exams,   label: isRtl ? "اختبارات" : "Exams"    },
        { href: `/dashboard/${groupId}/library`,  icon: ICONS.library, label: isRtl ? "المكتبة" : "Library"  },
        { href: `/dashboard/${groupId}/history`,  icon: ICONS.history, label: isRtl ? "السجل" : "History"  },
      ]
    : [
        { href: "/dashboard",             icon: ICONS.groups,      label: isRtl ? "مجموعاتي" : "My Groups" },
        { href: "/dashboard/instructors", icon: ICONS.instructors, label: isRtl ? "المعلمين" : "Instructors" },
      ];

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 65, backdropFilter: "blur(8px)" }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — slides in smoothly on mobile */}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-logo">
          <div className="logo-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
            <span className="logo-text">QuizForge</span>
            <span className="badge badge-brand" style={{ fontSize: "0.62rem", padding: "1px 6px" }}>PRO</span>
          </div>
          {mobileOpen && (
            <button
              className="btn btn-ghost btn-icon show-mobile"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
              style={{ width: 32, height: 32 }}
            >
              ✕
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          {groupId && (
            <Link
              href="/dashboard"
              className={`nav-item ${pathname === "/dashboard" ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
              style={{ marginBottom: 4 }}
            >
              <Icon path={ICONS.groups} />
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span className="flip-rtl" style={{ display: "inline-block" }}>←</span>
                <span>{isRtl ? "كافة المجموعات" : "All Groups"}</span>
              </span>
            </Link>
          )}

          {navSections.map((sec) => (
            <div key={sec.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              <div className="nav-section-label">{sec.label}</div>
              {sec.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-item ${pathname === item.href ? "active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon path={item.icon} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}

          <div style={{ flex: 1, minHeight: 20 }} />
        </nav>

        <div className="sidebar-footer">
          {user && (
            <div className="user-card" onClick={handleLogout} title={isRtl ? "تسجيل الخروج" : "Click to logout"}>
              <div className="avatar">
                {user.photoUrl ? (
                  <img src={user.photoUrl} alt={user.firstName} />
                ) : (
                  initials
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div className="user-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {user.firstName}
                  </div>
                  <span className="status-dot-online" title={isRtl ? "متصل" : "Online"} />
                </div>
                {user.username && (
                  <div className="user-handle">@{user.username}</div>
                )}
              </div>
              <Icon path={ICONS.logout} />
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div className="main-content">
        {/* Header */}
        <header className="page-header">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {/* Mobile hamburger menu toggle */}
            <button
              className="btn btn-ghost btn-icon show-mobile"
              onClick={() => setMobileOpen(true)}
              aria-label={isRtl ? "القائمة" : "Open menu"}
              title={isRtl ? "القائمة" : "Open menu"}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            {groupId && (
              <Link href="/dashboard" className="btn btn-ghost btn-sm hide-mobile" style={{ gap: 6 }}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="flip-rtl"
                >
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
                <span>{isRtl ? "كل المجموعات" : "All Groups"}</span>
              </Link>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {/* Language / Direction Toggle */}
            <button
              type="button"
              className="btn btn-secondary btn-sm lang-toggle-btn"
              onClick={toggleDirection}
              title={isRtl ? "Switch to English" : "التبديل إلى العربية"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: "var(--radius-full)",
                fontSize: "0.8rem",
                fontWeight: 600,
              }}
            >
              <span style={{ fontSize: "1rem", lineHeight: 1 }}>🌐</span>
              <span>{isRtl ? "English" : "العربية"}</span>
            </button>

            {groupId && (
              <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-primary btn-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                <span>{isRtl ? "كويز جديد" : "New Quiz"}</span>
              </Link>
            )}
            {user && (
              <div className="avatar sm hide-mobile" title={user.firstName}>
                {user.photoUrl ? (
                  <img src={user.photoUrl} alt={user.firstName} />
                ) : (
                  initials
                )}
              </div>
            )}
          </div>
        </header>

        {/* Page content */}
        <main className="page-body">
          {children}
        </main>
      </div>

      {/* Bottom Tab Bar — mobile only via CSS, always rendered */}
      <nav className="bottom-tab-bar" aria-label="Mobile Navigation">
        {bottomTabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={`bottom-tab-item ${pathname === tab.href ? "active" : ""}`}
          >
            <Icon path={tab.icon} />
            <span>{tab.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
