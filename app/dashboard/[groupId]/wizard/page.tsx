"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpenCheck, FileSpreadsheet, GraduationCap, Layers3, Sparkles } from "lucide-react";
import { useDirection } from "@/lib/useDirection";

type CreationTarget = "quiz" | "exam";
type CreationSource = "manual" | "bulk" | "ai";

export default function CreationWizardPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isRtl } = useDirection();
  const [target, setTarget] = useState<CreationTarget>(() => searchParams.get("target") === "exam" ? "exam" : "quiz");
  const [source, setSource] = useState<CreationSource>("manual");

  const copy = useMemo(() => isRtl ? {
    eyebrow: "مساحة إنشاء موحّدة",
    title: "ابدأ من هنا",
    description: "اختر ما تريد إنشاءه وطريقة تجهيز الأسئلة. ستنتقل مباشرة إلى المسار المناسب مع الاحتفاظ باختيارك.",
    targetTitle: "ما الذي تريد إنشاءه؟",
    quiz: "كويز Telegram",
    quizDescription: "أسئلة تفاعلية تظهر في المجموعة، مع إرسال فوري أو مجدول.",
    exam: "اختبار متكامل",
    examDescription: "اختبار له وقت ودرجة نجاح ونتائج محفوظة لكل طالب.",
    sourceTitle: "كيف ستجهّز الأسئلة؟",
    manual: "إنشاء يدوي",
    manualDescription: "أضف الأسئلة والإجابات مباشرة في المحرر.",
    bulk: "استيراد مجمع",
    bulkDescription: "استورد من Excel أو Word أو CSV أو نص، راجع الأسئلة ثم أكمل.",
    ai: "المساعد الذكي",
    aiDescription: "ولّد أسئلة من المنهج أو من نص تلصقه، ثم راجعها قبل الاستخدام.",
    continue: "متابعة إلى الإنشاء",
    hint: "يمكنك تغيير نوع المحتوى في أي وقت قبل المتابعة.",
  } : {
    eyebrow: "Unified creation workspace",
    title: "Start with what you need",
    description: "Choose what you are making and how to prepare its questions. We’ll open the matching workflow and keep your selection.",
    targetTitle: "What do you want to create?",
    quiz: "Telegram quiz",
    quizDescription: "Interactive questions posted to your group now or on a schedule.",
    exam: "Full exam",
    examDescription: "A timed assessment with a passing score and saved student results.",
    sourceTitle: "How will you prepare the questions?",
    manual: "Create manually",
    manualDescription: "Write questions and answers directly in the editor.",
    bulk: "Bulk import",
    bulkDescription: "Import Excel, Word, CSV, or text, review each question, then continue.",
    ai: "AI assistant",
    aiDescription: "Generate questions from course material or pasted text, then review them.",
    continue: "Continue to creation",
    hint: "You can change the content type before continuing.",
  }, [isRtl]);

  const selectTarget = (nextTarget: CreationTarget) => {
    setTarget(nextTarget);
  };

  const continueToFlow = () => {
    const destination = source === "bulk"
      ? `/dashboard/${groupId}/bulk?target=${target}`
      : source === "ai"
        ? `/dashboard/${groupId}/curriculum?output=${target}`
        : target === "exam"
          ? `/dashboard/${groupId}/exams?mode=create`
          : `/dashboard/${groupId}/quiz/new`;

    router.push(destination);
  };

  const Arrow = isRtl ? ArrowLeft : ArrowRight;

  return (
    <main className="creation-wizard" dir={isRtl ? "rtl" : "ltr"}>
      <header className="creation-wizard__header">
        <span className="creation-wizard__eyebrow"><Sparkles size={15} />{copy.eyebrow}</span>
        <h1>{copy.title}</h1>
        <p>{copy.description}</p>
      </header>

      <section className="creation-wizard__section" aria-labelledby="creation-target-title">
        <div className="creation-wizard__section-heading">
          <span className="creation-wizard__step">1</span>
          <h2 id="creation-target-title">{copy.targetTitle}</h2>
        </div>
        <div className="creation-wizard__targets">
          <button
            type="button"
            className={`creation-wizard__target ${target === "quiz" ? "is-selected" : ""}`}
            aria-pressed={target === "quiz"}
            onClick={() => selectTarget("quiz")}
          >
            <span className="creation-wizard__icon"><BookOpenCheck size={23} /></span>
            <span className="creation-wizard__target-copy"><strong>{copy.quiz}</strong><small>{copy.quizDescription}</small></span>
            <span className="creation-wizard__radio" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`creation-wizard__target ${target === "exam" ? "is-selected" : ""}`}
            aria-pressed={target === "exam"}
            onClick={() => selectTarget("exam")}
          >
            <span className="creation-wizard__icon creation-wizard__icon--exam"><GraduationCap size={24} /></span>
            <span className="creation-wizard__target-copy"><strong>{copy.exam}</strong><small>{copy.examDescription}</small></span>
            <span className="creation-wizard__radio" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="creation-wizard__section" aria-labelledby="creation-source-title">
        <div className="creation-wizard__section-heading">
          <span className="creation-wizard__step">2</span>
          <h2 id="creation-source-title">{copy.sourceTitle}</h2>
        </div>
        <div className="creation-wizard__sources">
          {([
            { id: "manual", icon: <BookOpenCheck size={21} />, title: copy.manual, description: copy.manualDescription },
            { id: "bulk", icon: <FileSpreadsheet size={21} />, title: copy.bulk, description: copy.bulkDescription },
            { id: "ai", icon: <Layers3 size={21} />, title: copy.ai, description: copy.aiDescription },
          ] as const).map((item) => (
            <button
              type="button"
              key={item.id}
              className={`creation-wizard__source ${source === item.id ? "is-selected" : ""}`}
              aria-pressed={source === item.id}
              onClick={() => setSource(item.id)}
            >
              <span className="creation-wizard__source-icon">{item.icon}</span>
              <span><strong>{item.title}</strong><small>{item.description}</small></span>
              <span className="creation-wizard__radio" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <footer className="creation-wizard__footer">
        <p>{copy.hint}</p>
        <button type="button" className="btn btn-primary creation-wizard__continue" onClick={continueToFlow}>
          <span>{copy.continue}</span><Arrow size={18} />
        </button>
      </footer>
    </main>
  );
}
