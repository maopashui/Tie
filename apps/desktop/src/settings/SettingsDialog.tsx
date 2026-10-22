import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useRef, useState } from "react";
import { useI18n, useT, type LocalePreference } from "../i18n";
import { useTheme, type ThemePreference } from "../theme";

type SectionId = "appearance" | "language" | "about";

const SECTIONS: SectionId[] = ["appearance", "language", "about"];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const localePreference = useI18n((state) => state.preference);
  const setLocalePreference = useI18n((state) => state.setPreference);
  const themePreference = useTheme((state) => state.preference);
  const setThemePreference = useTheme((state) => state.setPreference);
  const [version, setVersion] = useState("");
  const [active, setActive] = useState<SectionId>("appearance");
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});
  const scrollingTo = useRef<SectionId | null>(null);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion(""));
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (scrollingTo.current) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const id = visible[0]?.target.getAttribute("data-section") as SectionId | null;
        if (id) setActive(id);
      },
      { root, threshold: [0.35, 0.55, 0.75] },
    );
    for (const id of SECTIONS) {
      const node = sectionRefs.current[id];
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, []);

  function goTo(id: SectionId) {
    setActive(id);
    scrollingTo.current = id;
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      if (scrollingTo.current === id) scrollingTo.current = null;
    }, 500);
  }

  const themeOptions: { id: ThemePreference; label: string }[] = [
    { id: "system", label: t("followSystem") },
    { id: "light", label: t("themeLight") },
    { id: "dark", label: t("themeDark") },
  ];
  const localeOptions: { id: LocalePreference; label: string }[] = [
    { id: "system", label: t("followSystem") },
    { id: "zh-CN", label: t("langZh") },
    { id: "en", label: t("langEn") },
  ];
  const navItems: { id: SectionId; label: string }[] = [
    { id: "appearance", label: t("appearance") },
    { id: "language", label: t("language") },
    { id: "about", label: t("about") },
  ];

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-tie-overlay" onMouseDown={onClose}>
      <div
        className="flex h-[420px] w-[680px] overflow-hidden rounded border border-tie-border bg-tie-card text-[11px] shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <aside className="flex w-40 shrink-0 flex-col border-r border-tie-border bg-tie-subtle py-2">
          <div className="mb-2 px-3 font-semibold text-tie-text">{t("settings")}</div>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`mx-1 rounded px-2 py-1.5 text-left ${
                active === item.id ? "bg-tie-card font-medium text-tie-text" : "text-tie-muted hover:bg-tie-card/70"
              }`}
              onClick={() => goTo(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
          <button className="mt-auto px-3 py-2 text-left text-tie-muted hover:text-tie-text" onClick={onClose} type="button">
            {t("close")}
          </button>
        </aside>
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <section
            ref={(node) => {
              sectionRefs.current.appearance = node;
            }}
            className="py-3"
            data-section="appearance"
          >
            <h3 className="mb-2 font-medium text-tie-text">{t("appearance")}</h3>
            <p className="mb-2 text-tie-muted">{t("theme")}</p>
            <div className="grid gap-1">
              {themeOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-tie-subtle">
                  <input
                    checked={themePreference === option.id}
                    name="theme"
                    type="radio"
                    onChange={() => setThemePreference(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </section>
          <div className="mx-1 border-t border-tie-border" aria-hidden="true" />
          <section
            ref={(node) => {
              sectionRefs.current.language = node;
            }}
            className="py-3"
            data-section="language"
          >
            <h3 className="mb-2 font-medium text-tie-text">{t("language")}</h3>
            <div className="grid gap-1">
              {localeOptions.map((option) => (
                <label key={option.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-tie-subtle">
                  <input
                    checked={localePreference === option.id}
                    name="locale"
                    type="radio"
                    onChange={() => setLocalePreference(option.id)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </section>
          <div className="mx-1 border-t border-tie-border" aria-hidden="true" />
          <section
            ref={(node) => {
              sectionRefs.current.about = node;
            }}
            className="py-3"
            data-section="about"
          >
            <h3 className="mb-2 font-medium text-tie-text">{t("about")}</h3>
            <div className="flex items-center justify-between text-tie-muted">
              <span>{t("version")}</span>
              <span className="font-mono text-tie-text">{version || "—"}</span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
