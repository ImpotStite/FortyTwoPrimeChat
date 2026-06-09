import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { SEO_AUTOMATION, SEO_PRIME, SEO_TEST } from "../lib/seoCopy";

function canonicalBase(): string {
  const fromEnv = import.meta.env.VITE_SITE_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

function setMetaAttr(
  selectorAttr: "name" | "property",
  key: string,
  content: string
): void {
  const sel =
    selectorAttr === "property"
      ? `meta[property="${key}"]`
      : `meta[name="${key}"]`;
  let el = document.head.querySelector(sel) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(selectorAttr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href: string): void {
  let link = document.head.querySelector(
    'link[rel="canonical"]'
  ) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }
  link.href = href;
}

function setRobots(content: string | null): void {
  const el = document.head.querySelector(
    'meta[name="robots"]'
  ) as HTMLMetaElement | null;
  if (content === null) {
    el?.remove();
    return;
  }
  if (!el) {
    const m = document.createElement("meta");
    m.setAttribute("name", "robots");
    m.setAttribute("content", content);
    document.head.appendChild(m);
    return;
  }
  el.setAttribute("content", content);
}

export function RouteSeo(): null {
  const { pathname } = useLocation();

  useEffect(() => {
    const base = canonicalBase();
    const canonical =
      pathname === "/" ? `${base}/` : `${base}${pathname}`;

    const isTest = pathname === "/test" || pathname.startsWith("/test/");
    const isAutomation =
      pathname === "/automatisation" ||
      pathname.startsWith("/automatisation/");
    const title = isTest
      ? SEO_TEST.title
      : isAutomation
        ? SEO_AUTOMATION.title
        : SEO_PRIME.title;
    const description = isTest
      ? SEO_TEST.description
      : isAutomation
        ? SEO_AUTOMATION.description
        : SEO_PRIME.description;

    document.title = title;
    setMetaAttr("name", "description", description);
    setMetaAttr("property", "og:title", title);
    setMetaAttr("property", "og:description", description);
    setMetaAttr("property", "og:url", canonical);
    setMetaAttr("name", "twitter:title", title);
    setMetaAttr("name", "twitter:description", description);

    setCanonical(canonical);

    if (isTest || isAutomation) {
      setRobots("noindex, nofollow");
    } else {
      setRobots(null);
    }
  }, [pathname]);

  return null;
}
