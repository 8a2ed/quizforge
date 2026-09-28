"use client";

import { useState, useEffect, useCallback } from "react";

export function useDirection() {
  const [isRtl, setIsRtl] = useState<boolean>(() => {
    if (typeof document !== "undefined") {
      return (document.documentElement.getAttribute("dir") || "rtl") === "rtl";
    }
    return true;
  });

  useEffect(() => {
    const handleDirChange = () => {
      const currentDir = document.documentElement.getAttribute("dir") || "rtl";
      setIsRtl(currentDir === "rtl");
    };

    // Initial check
    handleDirChange();

    window.addEventListener("quizforge:dir-change", handleDirChange);
    window.addEventListener("storage", handleDirChange);
    return () => {
      window.removeEventListener("quizforge:dir-change", handleDirChange);
      window.removeEventListener("storage", handleDirChange);
    };
  }, []);

  const toggleDirection = useCallback(() => {
    const nextDir = isRtl ? "ltr" : "rtl";
    const nextLang = isRtl ? "en" : "ar";

    document.documentElement.setAttribute("dir", nextDir);
    document.documentElement.setAttribute("lang", nextLang);

    try {
      localStorage.setItem("quizforge_dir", nextDir);
      localStorage.setItem("quizforge_lang", nextLang);
    } catch {}

    setIsRtl(!isRtl);
    window.dispatchEvent(new Event("quizforge:dir-change"));
  }, [isRtl]);

  return {
    isRtl,
    toggleDirection,
    dir: isRtl ? "rtl" : "ltr",
    lang: isRtl ? "ar" : "en",
  };
}
