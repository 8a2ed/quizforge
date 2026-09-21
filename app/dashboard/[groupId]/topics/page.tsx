"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";

interface Topic {
  message_thread_id: number;
  name: string;
  icon_color?: number;
  icon_custom_emoji_id?: string;
  is_closed?: boolean;
}

const COLOR_OPTIONS = [
  { value: 7322096,  name: "أزرق",   hex: "#6FB9F0" },
  { value: 9367192,  name: "أخضر",   hex: "#8EEE98" },
  { value: 16766590, name: "أصفر",   hex: "#FFD67E" },
  { value: 13338331, name: "بنفسجي", hex: "#CB86DB" },
  { value: 16749490, name: "وردي",   hex: "#FF93B2" },
  { value: 16478047, name: "أحمر",   hex: "#FB6F5F" },
];

interface ParsedBulkTopic {
  topicId: number;
  name: string;
}

function parseBulkText(text: string): ParsedBulkTopic[] {
  const lines = text.split("\n");
  const result: ParsedBulkTopic[] = [];
  const seenIds = new Set<number>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Pattern 1: Telegram link (e.g. https://t.me/agricult1/3677 or https://t.me/c/12345/3677)
    const linkMatch = line.match(/t\.me\/(?:c\/\d+|\w+)\/(\d+)/i);
    if (linkMatch) {
      const id = parseInt(linkMatch[1], 10);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        const remaining = line.replace(linkMatch[0], "").replace(/[-:–—|]/g, "").trim();
        result.push({ topicId: id, name: remaining || `Topic #${id}` });
        continue;
      }
    }

    // Pattern 2: "3683 - علم الحيوان" or "3683 : علم الحيوان" or "3683 علم الحيوان"
    const leadingIdMatch = line.match(/^(\d{2,10})\s*[-:–—|,]?\s*(.*)$/);
    if (leadingIdMatch) {
      const id = parseInt(leadingIdMatch[1], 10);
      const name = leadingIdMatch[2]?.trim() || `Topic #${id}`;
      if (!seenIds.has(id)) {
        seenIds.add(id);
        result.push({ topicId: id, name });
        continue;
      }
    }

    // Pattern 3: "علم الحيوان : 3683" or "علم الحيوان - 3683"
    const trailingIdMatch = line.match(/^(.*?)\s*[-:–—|,]?\s*(\d{2,10})$/);
    if (trailingIdMatch) {
      const name = trailingIdMatch[1]?.trim() || `Topic #${trailingIdMatch[2]}`;
      const id = parseInt(trailingIdMatch[2], 10);
      if (!seenIds.has(id)) {
        seenIds.add(id);
        result.push({ topicId: id, name });
        continue;
      }
    }
  }

  return result;
}

export default function TopicsPage() {
  const params = useParams();
  const groupId = params.groupId as string;

  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoCreating, setAutoCreating] = useState(false);
  const [isForum, setIsForum] = useState<boolean | null>(null);
  const [canManageTopics, setCanManageTopics] = useState<boolean | null>(null);
  const [forumWarning, setForumWarning] = useState<string | null>(null);
  const [permissionWarning, setPermissionWarning] = useState<string | null>(null);

  // Add form state
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<number>(7322096);
  const [showManualLink, setShowManualLink] = useState(false);
  const [manualTopicId, setManualTopicId] = useState("");
  const [adding, setAdding] = useState(false);

  // Bulk Import modal state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);

  // Edit topic modal
  const [editingTopic, setEditingTopic] = useState<Topic | null>(null);
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete modal
  const [deletingTopic, setDeletingTopic] = useState<Topic | null>(null);
  const [deleteFromTelegram, setDeleteFromTelegram] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [toast, setToast] = useState<{ type: "success" | "error" | "info"; msg: string } | null>(null);

  const showToast = (type: "success" | "error" | "info", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const load = useCallback(async (autoCreate = false) => {
    if (autoCreate) setAutoCreating(true);
    else setLoading(true);

    try {
      const url = `/api/groups/${groupId}/topics${autoCreate ? "?autoCreate=true" : ""}`;
      const res = await fetch(url);
      const d = await res.json();

      if (d.ok || Array.isArray(d.topics)) {
        setTopics(d.topics || []);
        setIsForum(d.isForum ?? null);
        setCanManageTopics(d.canManageTopics ?? null);
        setForumWarning(d.forumWarning || null);
        setPermissionWarning(d.permissionWarning || null);

        if (autoCreate) {
          if (d.createdCount > 0) {
            showToast("success", `🎉 تم إنشاء ${d.createdCount} توبيك جديد في تليجرام وحفظهم!`);
          } else {
            showToast("info", "✅ التوبيكس الأساسية مسجلة بالفعل.");
          }
        }
      } else {
        if (d.forumWarning) setForumWarning(d.forumWarning);
        if (d.permissionWarning) setPermissionWarning(d.permissionWarning);
        if (d.message) showToast("error", d.message);
      }
    } catch (e) {
      console.error(e);
      showToast("error", "تعذر الاتصال بقاعدة البيانات أو تليجرام.");
    } finally {
      setLoading(false);
      setAutoCreating(false);
    }
  }, [groupId]);

  useEffect(() => {
    load(false);
  }, [load]);

  // Handle adding / creating topic
  const handleAdd = async () => {
    if (!newName.trim() && !manualTopicId) return;
    setAdding(true);

    try {
      const payload: { name: string; iconColor?: number; topicId?: number; createInTelegram?: boolean } = {
        name: newName.trim(),
      };

      if (showManualLink && manualTopicId.trim()) {
        payload.topicId = Number(manualTopicId.trim());
        payload.createInTelegram = false;
      } else {
        payload.iconColor = newColor;
        payload.createInTelegram = true;
      }

      const res = await fetch(`/api/groups/${groupId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data.ok) {
        setNewName("");
        setManualTopicId("");
        setShowManualLink(false);
        const actionMsg = data.createdInTelegram
          ? `✨ تم إنشاء توبيك "${data.topic.name}" مباشرة في تليجرام بنجاح!`
          : `✅ تم ربط توبيك "${data.topic.name}" بنجاح!`;
        showToast("success", actionMsg);
        load(false);
      } else {
        showToast("error", data.error || "فشل إنشاء التوبيك");
      }
    } catch {
      showToast("error", "حدث خطأ غير متوقع أثناء إنشاء التوبيك");
    } finally {
      setAdding(false);
    }
  };

  // Handle Bulk Import
  const handleBulkSubmit = async () => {
    const parsed = parseBulkText(bulkText);
    if (parsed.length === 0) {
      showToast("error", "لم يتم العثور على موضوعات صالحة. تأكد من إدخال رقم الموضوع أو رابطه.");
      return;
    }

    setBulkImporting(true);
    try {
      const res = await fetch(`/api/groups/${groupId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bulkTopics: parsed }),
      });
      const data = await res.json();
      if (data.ok) {
        showToast("success", `🎉 تم استيراد وحفظ ${data.count} موضوع بنجاح!`);
        setShowBulkModal(false);
        setBulkText("");
        load(false);
      } else {
        showToast("error", data.error || "فشل الاستيراد");
      }
    } catch {
      showToast("error", "تعذر استيراد التوبيكس");
    } finally {
      setBulkImporting(false);
    }
  };

  // Handle renaming
  const handleSaveEdit = async () => {
    if (!editingTopic || !editName.trim()) return;
    setSavingEdit(true);

    try {
      const res = await fetch(`/api/groups/${groupId}/topics`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topicId: editingTopic.message_thread_id, name: editName.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setTopics(prev =>
          prev.map(t =>
            t.message_thread_id === editingTopic.message_thread_id
              ? { ...t, name: editName.trim() }
              : t
          )
        );
        showToast("success", `تم تعديل اسم التوبيك إلى "${editName.trim()}" بنجاح`);
        setEditingTopic(null);
      } else {
        showToast("error", data.error || "فشل تعديل الاسم");
      }
    } catch {
      showToast("error", "تعذر تعديل التوبيك");
    } finally {
      setSavingEdit(false);
    }
  };

  // Handle delete
  const handleConfirmDelete = async () => {
    if (!deletingTopic) return;
    const targetId = deletingTopic.message_thread_id;
    const targetName = deletingTopic.name;
    setDeleting(true);

    try {
      const res = await fetch(`/api/groups/${groupId}/topics`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId: targetId,
          deleteFromTelegram,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        // Immediately remove from UI
        setTopics(prev => prev.filter(t => t.message_thread_id !== targetId));
        showToast(
          "success",
          deleteFromTelegram
            ? `تم حذف "${targetName}" من QuizForge وتليجرام نهائياً`
            : `تمت إزالة "${targetName}" وفصله نهائياً`
        );
        setDeletingTopic(null);
        setDeleteFromTelegram(false);
      } else {
        showToast("error", data.error || "فشل حذف التوبيك");
      }
    } catch {
      showToast("error", "حدث خطأ أثناء الحذف");
    } finally {
      setDeleting(false);
    }
  };

  const parsedBulkPreview = parseBulkText(bulkText);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", paddingBottom: "var(--space-12)" }}>
      {/* Toast Notification */}
      {toast && (
        <div className="toast-container" style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999 }}>
          <div className={`toast toast-${toast.type}`} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "12px 18px",
            background: toast.type === "success" ? "#064e3b" : toast.type === "error" ? "#7f1d1d" : "#1e293b",
            color: "#fff", borderRadius: "var(--radius-md)", boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
            border: `1px solid ${toast.type === "success" ? "#059669" : toast.type === "error" ? "#dc2626" : "#475569"}`
          }}>
            <span>{toast.type === "success" ? "✅" : toast.type === "error" ? "❌" : "ℹ️"}</span>
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>{toast.msg}</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="section-header animate-fade-up" style={{
        display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "var(--space-4)",
        marginBottom: "var(--space-5)"
      }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, margin: 0 }}>موضوعات المنتدى (Forum Topics)</h1>
          <p style={{ color: "var(--clr-text-secondary)", marginTop: 4, fontSize: "0.9rem" }}>
            إدارة ومزامنة أقسام وتوبيكس مجموعتك في تليجرام بدقة وسرعة
          </p>
        </div>

        <div style={{ display: "flex", gap: "var(--space-3)", flexWrap: "wrap" }}>
          {/* Bulk Import button */}
          <button
            className="btn btn-secondary"
            onClick={() => setShowBulkModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
            title="استيراد عدة موضوعات دفعة واحدة بالروابط أو الأرقام"
          >
            <span>📋</span>
            استيراد سريع متعدد (Bulk)
          </button>

          {/* Simple Refresh button */}
          <button
            className="btn btn-secondary"
            onClick={() => load(false)}
            disabled={loading || autoCreating}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
            title="تحديث القائمة الحالية من قاعدة البيانات"
          >
            <span>↻</span>
            {loading ? "جاري التحديث…" : "تحديث القائمة"}
          </button>

          {/* Auto-create Standard Topics */}
          <button
            className="btn btn-primary"
            onClick={() => load(true)}
            disabled={loading || autoCreating}
            style={{
              background: "linear-gradient(135deg, #4f7fff 0%, #a78bfa 100%)",
              display: "flex", alignItems: "center", gap: 8,
              boxShadow: "0 4px 14px rgba(79, 127, 255, 0.35)",
              fontWeight: 600
            }}
            title="صنع الأقسام التعليمية القياسية الخمسة في تليجرام"
          >
            {autoCreating ? (
              <>
                <span className="spinner-border" style={{ width: 16, height: 16, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 1s linear infinite" }} />
                جاري الصنع في تليجرام…
              </>
            ) : (
              <>
                <span>✨</span>
                توليد 5 توبيكس قياسية
              </>
            )}
          </button>
        </div>
      </div>

      {/* Hero Tip: Telegram In-Chat Sync Command */}
      <div className="card animate-fade-up" style={{
        background: "linear-gradient(135deg, rgba(79, 127, 255, 0.08) 0%, rgba(167, 139, 250, 0.08) 100%)",
        border: "1px solid rgba(79, 127, 255, 0.25)",
        padding: "var(--space-4) var(--space-5)",
        marginBottom: "var(--space-5)",
        borderRadius: "var(--radius-lg)",
      }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <span style={{ fontSize: "1.6rem" }}>⚡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: "0.98rem", color: "var(--clr-text-primary)", marginBottom: 4 }}>
              أسرع طريقة لتسجيل التوبيكس الموجودة حالياً في مجموعتك بتليجرام:
            </div>
            <div style={{ fontSize: "0.88rem", color: "var(--clr-text-secondary)", lineHeight: 1.7 }}>
              افتح أي توبيك موجود في مجموعتك واكتب فيه فقط:
              <span style={{ display: "inline-block", margin: "0 6px" }}>
                <code style={{ background: "rgba(79, 127, 255, 0.2)", padding: "3px 10px", borderRadius: 6, color: "#60a5fa", fontWeight: 700, fontSize: "0.92rem" }}>
                  /topic اسم الموضوع
                </code>
              </span>
              (أو فقط <code>/topic</code> أو <code>/sync</code>)، وسيقوم البوت فوراً بالتقاط المعرّف وحفظه وتأكيده لك في ثانية واحدة!
            </div>
          </div>
        </div>
      </div>

      {/* Warnings & Telegram Status */}
      {forumWarning && (
        <div className="card animate-fade-up" style={{
          marginBottom: "var(--space-5)",
          background: "rgba(251,191,36,0.08)",
          border: "1px solid rgba(251,191,36,0.3)",
          padding: "var(--space-4)",
        }}>
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <span style={{ fontSize: "1.4rem" }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 600, color: "#fbbf24", marginBottom: 4 }}>
                نظام الموضوعات (Topics) غير مفعل في المجموعة
              </div>
              <div style={{ fontSize: "0.88rem", color: "var(--clr-text-secondary)", lineHeight: 1.6 }}>
                {forumWarning}
              </div>
              <div style={{ fontSize: "0.82rem", marginTop: 8, color: "var(--clr-text-muted)" }}>
                💡 <strong>طريقة التفعيل:</strong> افتح تليجرام ← افتح المجموعة ← انقر على اسم المجموعة بالأعلى ← انقر على زر التعديل (القلم ✏️) ← فعّل خيار <strong>الموضوعات (Topics)</strong>.
              </div>
            </div>
          </div>
        </div>
      )}

      {permissionWarning && (
        <div className="card animate-fade-up" style={{
          marginBottom: "var(--space-5)",
          background: "rgba(248,113,113,0.08)",
          border: "1px solid rgba(248,113,113,0.3)",
          padding: "var(--space-4)",
        }}>
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
            <span style={{ fontSize: "1.4rem" }}>🔒</span>
            <div>
              <div style={{ fontWeight: 600, color: "#f87171", marginBottom: 4 }}>
                البوت بحاجة إلى صلاحية &quot;إدارة الموضوعات&quot; (Manage Topics)
              </div>
              <div style={{ fontSize: "0.88rem", color: "var(--clr-text-secondary)", lineHeight: 1.6 }}>
                {permissionWarning}
              </div>
              <div style={{ fontSize: "0.82rem", marginTop: 8, color: "var(--clr-text-muted)" }}>
                💡 <strong>طريقة منح الصلاحية:</strong> افتح المجموعة في تليجرام ← المشرفون (Administrators) ← اضغط على البوت ← فعّل صلاحية <strong>إدارة الموضوعات (Manage Topics)</strong>.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Create Single Topic Form */}
      <div className="card animate-fade-up animate-delay-1" style={{ marginBottom: "var(--space-6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-3)" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
              {showManualLink ? "🔗 ربط توبيك موجود مسبقاً برقم ID" : "➕ إنشاء توبيك جديد في تليجرام"}
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.82rem", color: "var(--clr-text-secondary)" }}>
              {showManualLink
                ? "أدخل رقم الـ Topic ID واسم الموضوع لحفظه وربطه"
                : "اكتب اسم الموضوع وسيتم إنشاؤه في تليجرام وحفظه تلقائياً"}
            </p>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowManualLink(!showManualLink)}
            style={{ fontSize: "0.8rem", color: "var(--clr-text-secondary)" }}
          >
            {showManualLink ? "⚡ العودة للإنشاء المباشر بالاسم" : "⚙️ ربط يدوي برقم ID محدد"}
          </button>
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: showManualLink ? "140px 1fr auto" : "1fr auto auto",
          gap: "var(--space-3)",
          alignItems: "flex-end"
        }}>
          {showManualLink ? (
            <div className="input-wrapper" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: "0.82rem" }}>رقم Topic ID</label>
              <input
                className="input"
                type="number"
                placeholder="3677"
                value={manualTopicId}
                onChange={(e) => setManualTopicId(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
          ) : (
            <div className="input-wrapper" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: "0.82rem" }}>اسم الموضوع في تليجرام</label>
              <input
                className="input"
                placeholder="مثال: أحياء - الفصل الثالث، كيمياء عضوية، مناقشات..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                disabled={adding}
              />
            </div>
          )}

          {showManualLink ? (
            <div className="input-wrapper" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: "0.82rem" }}>اسم الموضوع</label>
              <input
                className="input"
                placeholder="مثال: علم النبات"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                disabled={adding}
              />
            </div>
          ) : (
            <div className="input-wrapper" style={{ marginBottom: 0 }}>
              <label className="input-label" style={{ fontSize: "0.82rem" }}>لون الأيقونة</label>
              <div style={{ display: "flex", gap: 6, padding: "7px 10px", background: "var(--clr-bg-elevated)", borderRadius: "var(--radius-md)", border: "1px solid var(--clr-border)" }}>
                {COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    title={c.name}
                    onClick={() => setNewColor(c.value)}
                    style={{
                      width: 22, height: 22, borderRadius: "50%", background: c.hex, border: "none", cursor: "pointer",
                      transform: newColor === c.value ? "scale(1.2)" : "scale(1)",
                      outline: newColor === c.value ? "2px solid #fff" : "none",
                      transition: "transform 0.15s ease"
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <button
            className="btn btn-primary"
            onClick={handleAdd}
            disabled={adding || (showManualLink ? !manualTopicId : !newName.trim())}
            style={{ marginBottom: 0, height: 42, padding: "0 22px", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}
          >
            {adding ? (
              <>
                <span className="spinner-border" style={{ width: 14, height: 14, border: "2px solid #fff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 1s linear infinite" }} />
                جاري الحفظ…
              </>
            ) : showManualLink ? (
              "حفظ الربط"
            ) : (
              <>
                <span>🚀</span>
                إنشاء في تليجرام
              </>
            )}
          </button>
        </div>
      </div>

      {/* Topics List */}
      <div className="card animate-fade-up animate-delay-2">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>قائمة الموضوعات النشطة</h3>
            <span className="badge badge-brand" style={{ fontSize: "0.8rem", padding: "2px 8px" }}>
              {topics.length} توبيك
            </span>
          </div>

          <span style={{ fontSize: "0.82rem", color: "var(--clr-text-muted)" }}>
            أي موضوع يتم حذفه يختفي نهائياً ولا يعود أبداً
          </span>
        </div>

        {loading && topics.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-3) 0" }}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={{ height: 64, borderRadius: "var(--radius-md)" }} />
            ))}
          </div>
        ) : topics.length === 0 ? (
          <div className="empty-state" style={{ padding: "48px 24px", textAlign: "center" }}>
            <div style={{ fontSize: "3rem", marginBottom: 12 }}>💬</div>
            <h3 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: 8 }}>لا توجد أي موضوعات مسجلة حالياً</h3>
            <p style={{ color: "var(--clr-text-secondary)", maxWidth: 520, margin: "0 auto 24px", fontSize: "0.92rem", lineHeight: 1.6 }}>
              يمكنك كتابة <code>/topic اسم الموضوع</code> داخل أي توبيك في تليجرام، أو استخدام الاستيراد السريع للصق روابط موضوعاتك دفعة واحدة!
            </p>
            <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowBulkModal(true)}
              >
                📋 استيراد سريع متعدد
              </button>
              <button
                className="btn btn-primary"
                onClick={() => load(true)}
                disabled={autoCreating}
              >
                {autoCreating ? "جاري التوليد…" : "✨ توليد 5 توبيكس قياسية"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            {topics.map((topic) => {
              const hexColor = topic.icon_color
                ? `#${topic.icon_color.toString(16).padStart(6, "0")}`
                : "#6FB9F0";

              return (
                <div
                  key={topic.message_thread_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "var(--space-3) var(--space-4)",
                    background: "var(--clr-bg-elevated)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--clr-border)",
                    transition: "border-color 0.2s ease, transform 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                    {topic.is_closed ? (
                      <span title="موضوع مغلق (Closed Topic)" style={{ fontSize: "1.1rem" }}>🔒</span>
                    ) : (
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: hexColor,
                          display: "inline-block",
                          flexShrink: 0,
                          boxShadow: `0 0 10px ${hexColor}88`,
                        }}
                        title={`Color: ${hexColor}`}
                      />
                    )}

                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--clr-text-primary)" }}>
                        {topic.name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
                        <span style={{ fontSize: "0.78rem", color: "var(--clr-text-muted)" }}>
                          Thread ID: <code>#{topic.message_thread_id}</code>
                        </span>
                        {topic.is_closed && (
                          <span className="badge badge-warning" style={{ fontSize: "0.7rem", padding: "1px 6px" }}>
                            مغلق
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Rename Button */}
                    <button
                      className="btn btn-ghost btn-sm"
                      title="تعديل اسم الموضوع في تليجرام"
                      onClick={() => {
                        setEditingTopic(topic);
                        setEditName(topic.name);
                      }}
                      style={{ color: "var(--clr-text-secondary)", padding: "6px 10px" }}
                    >
                      ✏️ تعديل
                    </button>

                    {/* Delete Button */}
                    <button
                      className="btn btn-ghost btn-sm"
                      title="حذف الموضوع نهائياً"
                      onClick={() => {
                        setDeletingTopic(topic);
                        setDeleteFromTelegram(false);
                      }}
                      style={{ color: "var(--clr-danger)", padding: "6px 10px" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16
        }}>
          <div className="card" style={{ maxWidth: 580, width: "100%", padding: "var(--space-6)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700 }}>📋 استيراد سريع لعدة موضوعات</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowBulkModal(false)}>✕</button>
            </div>

            <p style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
              الصق روابط تليجرام الخاصة بالتوبيكس أو أرقامها وأسماءها (سطر لكل موضوع). يدعم الروابط المباشرة مثل <code>t.me/.../3678</code> أو الصيغ النصية:
            </p>

            <textarea
              className="input"
              rows={6}
              placeholder={`مثال:\nhttps://t.me/agricult1/3678 علم النبات\nhttps://t.me/agricult1/3685 كيمياء\n3690 - اقتصاد زراعي\n3695 فيزياء`}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              style={{ fontFamily: "monospace", fontSize: "0.85rem", resize: "vertical", marginBottom: 14 }}
            />

            {parsedBulkPreview.length > 0 && (
              <div style={{
                maxHeight: 140, overflowY: "auto", background: "var(--clr-bg-elevated)",
                border: "1px solid var(--clr-border)", borderRadius: "var(--radius-md)",
                padding: "8px 12px", marginBottom: 16
              }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--clr-text-muted)", marginBottom: 6 }}>
                  تم التعرف على ({parsedBulkPreview.length}) موضوع:
                </div>
                {parsedBulkPreview.map(p => (
                  <div key={p.topicId} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", padding: "3px 0" }}>
                    <span><strong>{p.name}</strong></span>
                    <span style={{ color: "var(--clr-accent)" }}>#{p.topicId}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
              <button className="btn btn-secondary" onClick={() => setShowBulkModal(false)} disabled={bulkImporting}>
                إلغاء
              </button>
              <button
                className="btn btn-primary"
                onClick={handleBulkSubmit}
                disabled={bulkImporting || parsedBulkPreview.length === 0}
                style={{ fontWeight: 600 }}
              >
                {bulkImporting ? "جاري الحفظ…" : `حفظ (${parsedBulkPreview.length}) موضوع دفعة واحدة`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Topic Modal */}
      {editingTopic && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16
        }}>
          <div className="card" style={{ maxWidth: 460, width: "100%", padding: "var(--space-6)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "1.15rem", fontWeight: 700 }}>✏️ تعديل اسم الموضوع</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--clr-text-secondary)", marginBottom: "var(--space-4)" }}>
              سيتم تحديث اسم الموضوع داخل مجموعة تليجرام وفي QuizForge ولا يعود للاسم القديم أبداً.
            </p>
            <div className="input-wrapper">
              <label className="input-label">الاسم الجديد</label>
              <input
                className="input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSaveEdit()}
                autoFocus
              />
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
              <button className="btn btn-secondary" onClick={() => setEditingTopic(null)} disabled={savingEdit}>
                إلغاء
              </button>
              <button className="btn btn-primary" onClick={handleSaveEdit} disabled={savingEdit || !editName.trim()}>
                {savingEdit ? "جاري الحفظ…" : "حفظ التعديل"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Topic Modal */}
      {deletingTopic && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16
        }}>
          <div className="card" style={{ maxWidth: 480, width: "100%", padding: "var(--space-6)" }}>
            <h3 style={{ margin: "0 0 8px", fontSize: "1.15rem", fontWeight: 700, color: "var(--clr-danger)" }}>
              🗑️ حذف موضوع &quot;{deletingTopic.name}&quot;
            </h3>
            <p style={{ fontSize: "0.88rem", color: "var(--clr-text-secondary)", lineHeight: 1.6, marginBottom: "var(--space-4)" }}>
              سيتم حذف الموضوع نهائياً وفصله من سجلات الكويزات لضمان عدم عودته مجدداً.
            </p>

            <label style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: "var(--radius-md)", cursor: "pointer", marginBottom: "var(--space-5)"
            }}>
              <input
                type="checkbox"
                checked={deleteFromTelegram}
                onChange={(e) => setDeleteFromTelegram(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: "var(--clr-danger)", cursor: "pointer" }}
              />
              <span style={{ fontSize: "0.85rem", color: "var(--clr-text-primary)" }}>
                <strong>حذف التوبيك أيضاً من مجموعة تليجرام</strong> (Delete from Telegram)
              </span>
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
              <button className="btn btn-secondary" onClick={() => setDeletingTopic(null)} disabled={deleting}>
                إلغاء
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmDelete}
                disabled={deleting}
                style={{ background: "var(--clr-danger)", color: "#fff" }}
              >
                {deleting ? "جاري الحذف…" : "تأكيد الحذف النهائي"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
