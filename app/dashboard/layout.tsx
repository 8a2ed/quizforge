"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

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
  admins:      "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  instructors: "M15 7a4 4 0 11-8 0 4 4 0 018 0zM3 20a9 9 0 0118 0H3z",
  settings:    "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  groups:      "M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z",
  logout:      "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<{ firstName: string; username?: string; photoUrl?: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Extract groupId from path — e.g. /dashboard/abc123/history → abc123
  const groupId = pathname.match(/\/dashboard\/([^/]+)/)?.[1];

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

  // Sidebar nav items (group-specific)
  const groupNavItems = groupId
    ? [
        { href: `/dashboard/${groupId}`,           icon: ICONS.home,      label: "Overview"    },
        { href: `/dashboard/${groupId}/quiz/new`,  icon: ICONS.quiz,      label: "Create Quiz" },
        { href: `/dashboard/${groupId}/bulk`,      icon: ICONS.bulk,      label: "Bulk Loader" },
        { href: `/dashboard/${groupId}/history`,   icon: ICONS.history,   label: "History"     },
        { href: `/dashboard/${groupId}/analytics`, icon: ICONS.analytics, label: "Analytics"   },
        { href: `/dashboard/${groupId}/topics`,    icon: "💬",            label: "Topics"      },
        { href: `/dashboard/${groupId}/admins`,    icon: ICONS.admins,    label: "Admins"      },
        { href: `/dashboard/${groupId}/settings`,  icon: ICONS.settings,  label: "Settings"    },
      ]
    : [];

  // Bottom tab items — show group tabs when inside a group, else show My Groups
  const bottomTabs = groupId
    ? [
        { href: `/dashboard/${groupId}`,          icon: ICONS.home,    label: "Overview"  },
        { href: `/dashboard/${groupId}/quiz/new`, icon: ICONS.quiz,    label: "Create"    },
        { href: `/dashboard/${groupId}/bulk`,     icon: ICONS.bulk,    label: "Bulk"      },
        { href: `/dashboard/${groupId}/history`,  icon: ICONS.history, label: "History"   },
        { href: `/dashboard/${groupId}/settings`, icon: ICONS.settings,label: "Settings"  },
      ]
    : [
        { href: "/dashboard",             icon: ICONS.groups,      label: "My Groups"   },
        { href: "/dashboard/instructors", icon: ICONS.instructors, label: "Instructors" },
      ];

  return (
    <div className="app-layout">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 49, backdropFilter: "blur(4px)" }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — hidden on mobile via CSS */}
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="sidebar-logo">
          <div className="logo-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="logo-text">QuizForge</span>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-label">Navigation</div>
          <Link
            href="/dashboard"
            className={`nav-item ${pathname === "/dashboard" ? "active" : ""}`}
            onClick={() => setMobileOpen(false)}
          >
            <Icon path={ICONS.groups} />
            My Groups
          </Link>

          {groupId && groupNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item ${pathname === item.href ? "active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <Icon path={item.icon} />
              {item.label}
            </Link>
          ))}

          <div style={{ flex: 1 }} />
        </nav>

        <div className="sidebar-footer">
          {user && (
            <div className="user-card" onClick={handleLogout} title="Click to logout">
              <div className="avatar">
                {user.photoUrl ? (
                  <img src={user.photoUrl} alt={user.firstName} />
                ) : (
                  initials
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="user-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.firstName}
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
            {groupId && (
              <Link href="/dashboard" className="btn btn-ghost btn-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
                All Groups
              </Link>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
            {groupId && (
              <Link href={`/dashboard/${groupId}/quiz/new`} className="btn btn-primary btn-sm">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
                New Quiz
              </Link>
            )}
            {user && (
              <div className="avatar sm hide-mobile">
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
      <nav className="bottom-tab-bar">
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
