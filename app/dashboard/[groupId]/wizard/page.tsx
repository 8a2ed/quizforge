"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useToast } from "@/components/ToastStack";
import { AccessibleModal } from "@/components/AccessibleModal";
import { useDirection } from "@/lib/useDirection";

const STORAGE_KEY = "qf_wizard_state";
const TOTAL_STEPS = 4;

const TEAM_TIERS = [
  { id: "Solo", title: "مراجعة فردية (Solo)", desc: "كويز تدريبي مرن بدون وقت محدد للمذاكرة الذاتية." },
  { id: "Small", title: "كويز سريع (Quick Quiz)", desc: "5 أسئلة بمهلة دقيقة ونصف لمراجعة سريعة." },
  { id: "Medium", title: "محاكي الميد ترم (Mock Exam)", desc: "20 سؤالاً بوقت محدد 15 دقيقة وشهادة نجاح." },
  { id: "Enterprise", title: "امتحان شامل (Comprehensive)", desc: "امتحان نهائي مع خلط عشوائي للأسئلة والخيارات." },
];

const STACK_OPTIONS = [
  "أساسيات البساتين",
  "علم الأراضي وتغذية النبات",
  "فسيولوجيا النبات",
  "علم الحشرات والمكافحة",
  "إنتاج المحاصيل الحقلية",
  "الإنتاج الحيواني والسمكي",
  "الكيمياء الحيوية الزراعية",
  "أمراض النبات والميكروبيولوجي",
  "الوراثة النباتية",
  "الميكنة الزراعية الحديثة",
];

export default function WizardPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;
  const { isRtl } = useDirection();
  const toast = useToast();

  const [currentStep, setCurrentStep] = useState(0);
  const [projectName, setProjectName] = useState("");
  const [projectDesc, setProjectDesc] = useState("");
  const [teamTier, setTeamTier] = useState("");
  const [selectedStack, setSelectedStack] = useState<string[]>([]);
  const [nameError, setNameError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Modal demo state
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // Load from sessionStorage
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        if (data.projectName) setProjectName(data.projectName);
        if (data.projectDesc) setProjectDesc(data.projectDesc);
        if (data.teamTier) setTeamTier(data.teamTier);
        if (Array.isArray(data.selectedStack)) setSelectedStack(data.selectedStack);
        if (typeof data.currentStep === "number" && data.currentStep < TOTAL_STEPS) {
          setCurrentStep(data.currentStep);
        }
      }
    } catch {}
  }, []);

  // Save to sessionStorage
  const persist = useCallback((updates: Partial<{ currentStep: number; projectName: string; projectDesc: string; teamTier: string; selectedStack: string[] }>) => {
    try {
      const next = {
        currentStep: updates.currentStep ?? currentStep,
        projectName: updates.projectName ?? projectName,
        projectDesc: updates.projectDesc ?? projectDesc,
        teamTier: updates.teamTier ?? teamTier,
        selectedStack: updates.selectedStack ?? selectedStack,
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  }, [currentStep, projectName, projectDesc, teamTier, selectedStack]);

  const isStepValid = (step: number) => {
    if (step === 0) {
      const trimmed = projectName.trim();
      return trimmed.length >= 3 && trimmed.length <= 60;
    }
    if (step === 1) return Boolean(teamTier);
    if (step === 2) return selectedStack.length > 0;
    return true;
  };

  const handleNameChange = (val: string) => {
    setProjectName(val);
    persist({ projectName: val });
    if (val.trim() && val.trim().length < 3) {
      setNameError(isRtl ? "اسم النموذج يجب أن يكون 3 أحرف على الأقل." : "Name must be at least 3 characters.");
    } else {
      setNameError("");
    }
  };

  const handleDescChange = (val: string) => {
    setProjectDesc(val);
    persist({ projectDesc: val });
  };

  const handleTierSelect = (tier: string) => {
    setTeamTier(tier);
    persist({ teamTier: tier });
  };

  const handleStackToggle = (item: string) => {
    const next = selectedStack.includes(item)
      ? selectedStack.filter((s) => s !== item)
      : [...selectedStack, item];
    setSelectedStack(next);
    persist({ selectedStack: next });
  };

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      if (isStepValid(currentStep)) {
        const next = currentStep + 1;
        setCurrentStep(next);
        persist({ currentStep: next });
      }
    } else {
      // Step 4: Review -> open confirmation modal
      setConfirmModalOpen(true);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      const prev = currentStep - 1;
      setCurrentStep(prev);
      persist({ currentStep: prev });
    }
  };

  const handleFinalSubmit = async () => {
    setConfirmModalOpen(false);
    setIsSubmitting(true);
    try {
      // Create quiz or exam via API
      const res = await fetch(`/api/groups/${groupId}/exams`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: projectName.trim(),
          description: projectDesc.trim(),
          timeLimit: teamTier === "Solo" ? null : teamTier === "Small" ? 90 : 900,
          passingScore: 60,
          questions: [
            {
              question: `سؤال توضيحي في ${selectedStack[0] || "المادة"}: ما هي المعايير الأساسية؟`,
              options: ["الخيار الأول (صحيح)", "الخيار الثاني", "الخيار الثالث", "الخيار الرابع"],
              correctOptionId: 0,
              explanation: "توضيح مفصل للحل والإجابة الصحيحة.",
            },
          ],
        }),
      });

      if (res.ok) {
        sessionStorage.removeItem(STORAGE_KEY);
        setIsSubmitted(true);
        toast.success(
          isRtl ? "تم إنشاء ونشر الاختبار بنجاح!" : "Quiz Created Successfully!",
          isRtl ? `تم تسجيل "${projectName}" ضمن اختبارات المجموعة.` : `"${projectName}" is now active in group exams.`
        );
      } else {
        toast.error(
          isRtl ? "فشل إنشاء الاختبار" : "Failed to create quiz",
          isRtl ? "يرجى المحاولة مرة أخرى لاحقاً." : "Please try again later."
        );
      }
    } catch {
      toast.error(isRtl ? "خطأ في الاتصال" : "Network error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const progressPct = ((currentStep + 1) / TOTAL_STEPS) * 100;
  const connectorPct = (currentStep / (TOTAL_STEPS - 1)) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0 48px" }}>
      {/* Wizard Container */}
      <div
        className="wizard-card-wrap"
        style={{
          width: "100%",
          maxWidth: "620px",
          backgroundColor: "#131316",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          borderRadius: "14px",
          boxShadow: "0 12px 40px rgba(0, 0, 0, 0.55)",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Animated 2px Top Progress Bar */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "2px", background: "rgba(255,255,255,0.05)", zIndex: 10 }}>
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              background: "linear-gradient(90deg, #10b981, #00d4ff)",
              transition: "width 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />
        </div>

        {/* Stepper Header */}
        <div style={{ padding: "32px 28px 20px", borderBottom: "1px solid rgba(255, 255, 255, 0.05)", background: "rgba(255, 255, 255, 0.015)" }}>
          <nav aria-label="Wizard Steps" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {/* Connector Line */}
            <div style={{ position: "absolute", left: "20px", right: "20px", top: "50%", transform: "translateY(-50%)", height: "2px", background: "rgba(255,255,255,0.08)", zIndex: 1 }}>
              <div
                style={{
                  height: "100%",
                  width: `${connectorPct}%`,
                  background: "linear-gradient(90deg, #10b981, #00d4ff)",
                  transition: "width 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              />
            </div>

            {["الأساسيات (Basics)", "النمط (Mode)", "المواضيع (Topics)", "المراجعة (Review)"].map((label, idx) => {
              const isActive = idx === currentStep;
              const isComplete = idx < currentStep;
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => { if (isComplete) setCurrentStep(idx); }}
                  aria-current={isActive ? "step" : undefined}
                  style={{
                    position: "relative",
                    zIndex: 2,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "6px",
                    background: "transparent",
                    border: "none",
                    cursor: isComplete ? "pointer" : "default",
                    outline: "none",
                  }}
                >
                  <div
                    style={{
                      width: "34px",
                      height: "34px",
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "0.85rem",
                      fontWeight: 700,
                      background: isActive ? "#00d4ff" : isComplete ? "#10b981" : "#18181c",
                      color: isActive || isComplete ? "#000000" : "#64748b",
                      border: `2px solid ${isActive ? "#00d4ff" : isComplete ? "#10b981" : "rgba(255,255,255,0.12)"}`,
                      boxShadow: isActive ? "0 0 18px rgba(0,212,255,0.35)" : isComplete ? "0 0 14px rgba(16,185,129,0.35)" : "none",
                      transform: isActive ? "scale(1.08)" : "scale(1)",
                      transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    {isComplete ? "✓" : idx + 1}
                  </div>
                  <span style={{ fontSize: "0.72rem", fontWeight: 600, color: isActive ? "#00d4ff" : isComplete ? "#94a3b8" : "#64748b" }}>
                    {label.split(" ")[0]}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Wizard Form Panels */}
        {!isSubmitted ? (
          <form onSubmit={(e) => { e.preventDefault(); handleNext(); }} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ padding: "32px 32px 24px", minHeight: "360px" }}>
              {/* Step 1: Basics */}
              {currentStep === 0 && (
                <section role="group" aria-labelledby="step-1-title" style={{ animation: "fadeIn 0.25s ease" }}>
                  <h2 id="step-1-title" style={{ fontSize: "1.25rem", fontWeight: 700, color: "#ffffff", marginBottom: "4px" }}>
                    {isRtl ? "أساسيات الاختبار والنموذج" : "Project Basics"}
                  </h2>
                  <p style={{ fontSize: "0.88rem", color: "#94a3b8", marginBottom: "22px" }}>
                    {isRtl ? "حدد عنوان الاختبار والوصف العام للمحتوى الدراسي." : "Set your project identifier and contextual details."}
                  </p>

                  <div style={{ marginBottom: "18px" }}>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#94a3b8", marginBottom: "6px" }} htmlFor="quiz-name">
                      {isRtl ? "عنوان الاختبار / المشروع" : "Project Name"} <span style={{ color: "#00d4ff" }}>*</span>
                    </label>
                    <input
                      id="quiz-name"
                      type="text"
                      value={projectName}
                      onChange={(e) => handleNameChange(e.target.value)}
                      placeholder={isRtl ? "مثال: مراجعة شاملة لميد ترم البساتين" : "e.g. Midterm Mock Exam"}
                      required
                      autoFocus
                      maxLength={60}
                      style={{
                        width: "100%",
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "8px",
                        padding: "11px 14px",
                        fontSize: "0.92rem",
                        color: "#ffffff",
                        outline: "none",
                      }}
                    />
                    <div style={{ fontSize: "0.78rem", color: "#f87171", minHeight: "18px", marginTop: "4px" }} aria-live="polite">
                      {nameError}
                    </div>
                  </div>

                  <div style={{ marginBottom: "18px" }}>
                    <label style={{ display: "block", fontSize: "0.82rem", fontWeight: 600, color: "#94a3b8", marginBottom: "6px" }} htmlFor="quiz-desc">
                      {isRtl ? "الوصف أو التعليمات" : "Description"} <span style={{ color: "#64748b" }}>({isRtl ? "اختياري" : "Optional"})</span>
                    </label>
                    <textarea
                      id="quiz-desc"
                      value={projectDesc}
                      onChange={(e) => handleDescChange(e.target.value)}
                      placeholder={isRtl ? "تعليمات خاصة بالطلاب أو الفصول المشمولة..." : "Brief summary of objectives or instructions..."}
                      maxLength={240}
                      rows={3}
                      style={{
                        width: "100%",
                        background: "rgba(255, 255, 255, 0.04)",
                        border: "1px solid rgba(255, 255, 255, 0.1)",
                        borderRadius: "8px",
                        padding: "11px 14px",
                        fontSize: "0.92rem",
                        color: "#ffffff",
                        outline: "none",
                        resize: "vertical",
                      }}
                    />
                    <div style={{ fontSize: "0.75rem", color: "#64748b", textAlign: isRtl ? "left" : "right" }}>
                      {projectDesc.length} / 240
                    </div>
                  </div>
                </section>
              )}

              {/* Step 2: Architecture / Mode */}
              {currentStep === 1 && (
                <section role="group" aria-labelledby="step-2-title" style={{ animation: "fadeIn 0.25s ease" }}>
                  <h2 id="step-2-title" style={{ fontSize: "1.25rem", fontWeight: 700, color: "#ffffff", marginBottom: "4px" }}>
                    {isRtl ? "نمط الاختبار والمهلة الزمنية" : "Team & Mode Architecture"}
                  </h2>
                  <p style={{ fontSize: "0.88rem", color: "#94a3b8", marginBottom: "20px" }}>
                    {isRtl ? "اختر النمط المناسب لجدول الاختبار وسلوك الإرسال." : "Select the mode that matches your target flow."}
                  </p>

                  <div role="radiogroup" aria-labelledby="step-2-title" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                    {TEAM_TIERS.map((tier) => {
                      const isChecked = teamTier === tier.id;
                      return (
                        <div
                          key={tier.id}
                          role="radio"
                          aria-checked={isChecked}
                          tabIndex={isChecked ? 0 : -1}
                          onClick={() => handleTierSelect(tier.id)}
                          onKeyDown={(e) => {
                            if (e.key === " " || e.key === "Enter") {
                              e.preventDefault();
                              handleTierSelect(tier.id);
                            }
                          }}
                          style={{
                            padding: "16px 14px",
                            background: isChecked ? "rgba(0, 212, 255, 0.06)" : "rgba(255, 255, 255, 0.04)",
                            border: `1px solid ${isChecked ? "#00d4ff" : "rgba(255, 255, 255, 0.1)"}`,
                            borderRadius: "10px",
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                            boxShadow: isChecked ? "0 0 20px rgba(0, 212, 255, 0.15)" : "none",
                            outline: "none",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                            <span style={{ fontSize: "0.92rem", fontWeight: 700, color: isChecked ? "#00d4ff" : "#ffffff" }}>
                              {tier.title}
                            </span>
                            <div
                              style={{
                                width: "16px",
                                height: "16px",
                                borderRadius: "50%",
                                border: `2px solid ${isChecked ? "#00d4ff" : "#64748b"}`,
                                background: isChecked ? "#00d4ff" : "transparent",
                              }}
                            />
                          </div>
                          <span style={{ fontSize: "0.78rem", color: "#94a3b8", lineHeight: 1.4 }}>{tier.desc}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Step 3: Topics & Stack */}
              {currentStep === 2 && (
                <section role="group" aria-labelledby="step-3-title" style={{ animation: "fadeIn 0.25s ease" }}>
                  <h2 id="step-3-title" style={{ fontSize: "1.25rem", fontWeight: 700, color: "#ffffff", marginBottom: "4px" }}>
                    {isRtl ? "المواد والمواضيع المشمولة" : "Technology & Topics Stack"}
                  </h2>
                  <p style={{ fontSize: "0.88rem", color: "#94a3b8", marginBottom: "20px" }}>
                    {isRtl ? "اختر موضوعاً واحداً على الأقل لربط الأسئلة به." : "Select at least one topic for your curriculum."}
                  </p>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                    {STACK_OPTIONS.map((item) => {
                      const isSelected = selectedStack.includes(item);
                      return (
                        <label
                          key={item}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "9px 15px",
                            fontSize: "0.85rem",
                            fontWeight: 600,
                            borderRadius: "8px",
                            background: isSelected ? "rgba(0, 212, 255, 0.12)" : "rgba(255, 255, 255, 0.04)",
                            border: `1px solid ${isSelected ? "#00d4ff" : "rgba(255, 255, 255, 0.1)"}`,
                            color: isSelected ? "#00d4ff" : "#94a3b8",
                            cursor: "pointer",
                            transition: "all 0.18s ease",
                            boxShadow: isSelected ? "0 0 14px rgba(0, 212, 255, 0.18)" : "none",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleStackToggle(item)}
                            style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
                          />
                          <span>{isSelected ? "✓" : "+"}</span>
                          <span>{item}</span>
                        </label>
                      );
                    })}
                  </div>
                </section>
              )}

              {/* Step 4: Review Summary */}
              {currentStep === 3 && (
                <section role="group" aria-labelledby="step-4-title" style={{ animation: "fadeIn 0.25s ease" }}>
                  <h2 id="step-4-title" style={{ fontSize: "1.25rem", fontWeight: 700, color: "#ffffff", marginBottom: "4px" }}>
                    {isRtl ? "المراجعة والتأكيد النهائي" : "Review & Confirmation"}
                  </h2>
                  <p style={{ fontSize: "0.88rem", color: "#94a3b8", marginBottom: "20px" }}>
                    {isRtl ? "تحقق من كافة التفاصيل قبل النشر على تيليجرام." : "Verify configuration before creating."}
                  </p>

                  <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "10px", overflow: "hidden" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700 }}>{isRtl ? "العنوان:" : "Project:"}</span>
                      <span style={{ flex: 1, margin: "0 14px", color: "#ffffff", fontWeight: 600 }}>{projectName}</span>
                      <button type="button" onClick={() => setCurrentStep(0)} style={{ background: "none", border: "none", color: "#00d4ff", cursor: "pointer", textDecoration: "underline", fontSize: "0.8rem" }}>
                        {isRtl ? "تعديل" : "Edit"}
                      </button>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700 }}>{isRtl ? "الوصف:" : "Desc:"}</span>
                      <span style={{ flex: 1, margin: "0 14px", color: "#ffffff", fontWeight: 600 }}>{projectDesc || "—"}</span>
                      <button type="button" onClick={() => setCurrentStep(0)} style={{ background: "none", border: "none", color: "#00d4ff", cursor: "pointer", textDecoration: "underline", fontSize: "0.8rem" }}>
                        {isRtl ? "تعديل" : "Edit"}
                      </button>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700 }}>{isRtl ? "النمط:" : "Mode:"}</span>
                      <span style={{ flex: 1, margin: "0 14px", color: "#ffffff", fontWeight: 600 }}>{teamTier}</span>
                      <button type="button" onClick={() => setCurrentStep(1)} style={{ background: "none", border: "none", color: "#00d4ff", cursor: "pointer", textDecoration: "underline", fontSize: "0.8rem" }}>
                        {isRtl ? "تعديل" : "Edit"}
                      </button>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", padding: "14px 18px" }}>
                      <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 700 }}>{isRtl ? "المواضيع:" : "Topics:"}</span>
                      <span style={{ flex: 1, margin: "0 14px", color: "#ffffff", fontWeight: 600 }}>{selectedStack.join(", ")}</span>
                      <button type="button" onClick={() => setCurrentStep(2)} style={{ background: "none", border: "none", color: "#00d4ff", cursor: "pointer", textDecoration: "underline", fontSize: "0.8rem" }}>
                        {isRtl ? "تعديل" : "Edit"}
                      </button>
                    </div>
                  </div>
                </section>
              )}
            </div>

            {/* Wizard Footer */}
            <div
              style={{
                padding: "20px 32px 24px",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(255, 255, 255, 0.015)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 0}
                style={{
                  padding: "11px 22px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  borderRadius: "8px",
                  background: "transparent",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#94a3b8",
                  cursor: currentStep === 0 ? "not-allowed" : "pointer",
                  opacity: currentStep === 0 ? 0.35 : 1,
                }}
              >
                {isRtl ? "السابق" : "Back"}
              </button>

              <button
                type="submit"
                disabled={!isStepValid(currentStep) || isSubmitting}
                style={{
                  padding: "11px 24px",
                  fontSize: "0.9rem",
                  fontWeight: 700,
                  borderRadius: "8px",
                  background: "linear-gradient(135deg, #00d4ff 0%, #00a4d8 100%)",
                  color: "#050b14",
                  border: "none",
                  cursor: !isStepValid(currentStep) || isSubmitting ? "not-allowed" : "pointer",
                  opacity: !isStepValid(currentStep) || isSubmitting ? 0.4 : 1,
                  boxShadow: "0 4px 18px rgba(0, 212, 255, 0.35)",
                }}
              >
                {currentStep === TOTAL_STEPS - 1
                  ? isRtl ? "تأكيد وإنشاء الاختبار 🚀" : "Create Project 🚀"
                  : isRtl ? "التالي ←" : "Next →"}
              </button>
            </div>
          </form>
        ) : (
          /* Success Panel */
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: "48px 32px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              textAlign: "center",
              gap: "16px",
            }}
          >
            <div
              style={{
                width: "64px",
                height: "64px",
                borderRadius: "50%",
                background: "rgba(16, 185, 129, 0.15)",
                color: "#10b981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #10b981",
                boxShadow: "0 0 24px rgba(16, 185, 129, 0.35)",
                fontSize: "30px",
                fontWeight: "bold",
              }}
            >
              ✓
            </div>
            <h2 style={{ fontSize: "1.4rem", fontWeight: 700, color: "#ffffff" }}>
              {isRtl ? "تم إنشاء الاختبار بنجاح!" : "Project Created Successfully!"}
            </h2>
            <p style={{ fontSize: "0.92rem", color: "#94a3b8", maxWidth: "420px" }}>
              {isRtl
                ? `تم ضبط "${projectName}" بنجاح ضمن نمط (${teamTier}) ومتاح الآن في قائمة الامتحانات.`
                : `"${projectName}" has been configured with ${teamTier} tier architecture and topics.`}
            </p>
            <div style={{ display: "flex", gap: "12px", marginTop: "12px" }}>
              <button
                type="button"
                onClick={() => router.push(`/dashboard/${groupId}/exams`)}
                style={{
                  padding: "10px 20px",
                  fontSize: "0.88rem",
                  fontWeight: 600,
                  borderRadius: "8px",
                  background: "#00d4ff",
                  color: "#050b14",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                {isRtl ? "عرض في قائمة الاختبارات" : "View in Exams"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSubmitted(false);
                  setCurrentStep(0);
                  setProjectName("");
                  setProjectDesc("");
                  setSelectedStack([]);
                }}
                style={{
                  padding: "10px 20px",
                  fontSize: "0.88rem",
                  fontWeight: 600,
                  borderRadius: "8px",
                  background: "transparent",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "#ffffff",
                  cursor: "pointer",
                }}
              >
                {isRtl ? "إنشاء اختبار آخر" : "Create Another"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal using AccessibleModal */}
      <AccessibleModal
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title={isRtl ? "تأكيد نشر الاختبار" : "Confirm Project Creation"}
        description={
          isRtl
            ? `أنت على وشك إنشاء ونشر "${projectName}". سيتمكن الطلاب من بدء الاختبار مباشرة بمجرد النشر.`
            : `You are about to launch "${projectName}". Students in this group will be able to start immediately.`
        }
        footer={
          <>
            <button
              type="button"
              onClick={() => setConfirmModalOpen(false)}
              style={{
                padding: "8px 16px",
                borderRadius: "8px",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#94a3b8",
                cursor: "pointer",
              }}
            >
              {isRtl ? "إلغاء" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={handleFinalSubmit}
              disabled={isSubmitting}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                background: "#00c4ff",
                color: "#050b14",
                border: "none",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              {isSubmitting ? (isRtl ? "جاري النشر..." : "Deploying...") : isRtl ? "نشر وتأكيد" : "Confirm & Launch"}
            </button>
          </>
        }
      >
        <div style={{ padding: "12px", background: "rgba(0, 196, 255, 0.08)", border: "1px solid rgba(0, 196, 255, 0.2)", borderRadius: "8px" }}>
          <div style={{ fontSize: "0.82rem", color: "#9fe7ff" }}>
            📌 {isRtl ? "المواضيع المشمولة:" : "Topics:"} <strong>{selectedStack.join(", ")}</strong>
          </div>
        </div>
      </AccessibleModal>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
