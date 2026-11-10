"use client";

import { BriefcaseBusiness, ChevronDown, GitFork, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/logo";
import { SuiWalletProvider, WalletConnect } from "@/components/wallet-connect";

const navigation = [
  { href: "/markets", label: "Markets" },
  { href: "/insights", label: "Traders" },
  { href: "/integrations", label: "Agents" },
  { href: "/about", label: "How it works" },
];

const createItems = [
  {
    href: "/markets/new/simple",
    icon: GitFork,
    title: "Simple choice",
    copy: "Crowd picks one of a few.",
  },
  {
    href: "/markets/new/opportunity",
    icon: BriefcaseBusiness,
    title: "Opportunity",
    copy: "Rank several proposals.",
  },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The one "New market" button. Hover or click opens the two formats. */
function CreateMenu() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pathname = usePathname();

  const close = () => {
    setOpen(false);
    setPinned(false);
  };

  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setOpen(false);
    setPinned(false);
  }

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const items = () =>
    Array.from(
      root.current?.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]') ??
        [],
    );

  return (
    <div
      ref={root}
      className="relative"
      onPointerEnter={(e) => {
        if (e.pointerType !== "mouse") return;
        clearTimeout(timer.current);
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType !== "mouse" || pinned) return;
        timer.current = setTimeout(() => setOpen(false), 180);
      }}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          close();
          trigger.current?.focus();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          if (!open) setOpen(true);
          setPinned(true);
          requestAnimationFrame(() => {
            const list = items();
            const at = list.indexOf(
              document.activeElement as HTMLAnchorElement,
            );
            list[(at + 1) % list.length]?.focus();
          });
        } else if (e.key === "ArrowUp" && open) {
          e.preventDefault();
          const list = items();
          const at = list.indexOf(document.activeElement as HTMLAnchorElement);
          if (at <= 0) trigger.current?.focus();
          else list[at - 1]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="button-primary !min-h-10 !px-4 !py-1.5 text-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open && pinned) close();
          else {
            setOpen(true);
            setPinned(true);
          }
        }}
      >
        New market
        <ChevronDown
          size={15}
          className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="New market format"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformOrigin: "top right" }}
            className="absolute top-full right-0 z-50 w-72 pt-2"
          >
            <div className="border-line-strong bg-panel rounded-2xl border p-2 shadow-[var(--shadow-soft)]">
              {createItems.map(({ href, icon: Icon, title, copy }) => (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  className="group hover:bg-panel-2 focus-visible:bg-panel-2 flex items-start gap-3 rounded-xl p-3 transition-colors"
                >
                  <span className="bg-ice/60 text-ink mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg">
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{title}</span>
                    <span className="text-ink/70 block text-xs">{copy}</span>
                  </span>
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function AppShell({
  children,
  memoryMode,
  allDemo,
}: {
  children: React.ReactNode;
  memoryMode: "demo" | "live";
  allDemo: boolean;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setMenuOpen(false);
  }
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    const frame = requestAnimationFrame(on);
    window.addEventListener("scroll", on, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", on);
    };
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        toggle.current?.focus();
      }
    };
    const wide = window.matchMedia("(min-width: 768px)");
    const onWide = () => wide.matches && setMenuOpen(false);
    document.addEventListener("keydown", esc);
    wide.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", esc);
      wide.removeEventListener("change", onWide);
    };
  }, [menuOpen]);

  const live = memoryMode === "live";
  const modeLabel = live ? "Walrus Mainnet" : "Local Memory";
  const modeTitle = allDemo
    ? "Local memory and offline providers. No Mainnet transactions."
    : "Some providers are live. Check Agents for details.";

  return (
    <SuiWalletProvider>
      <div className="flex min-h-screen flex-col">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <header
          className={`sticky top-0 z-40 transition-[background-color,border-color,backdrop-filter] duration-300 ${scrolled || menuOpen ? "border-line bg-ground/90 border-b backdrop-blur-md" : "border-b border-transparent"}`}
        >
          <div className="mx-auto flex h-16 w-full max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-6 lg:gap-8">
              <Logo />
              <nav
                className="hidden items-center gap-1 md:flex"
                aria-label="Primary navigation"
              >
                {navigation.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${active ? "text-ink" : "text-ink/70 hover:text-ink"}`}
                    >
                      {active && (
                        <motion.span
                          layoutId="nav-pill"
                          className="bg-panel-2 absolute inset-0 rounded-full"
                          transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 34,
                          }}
                        />
                      )}
                      <span className="relative">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <WalletConnect />
              <span
                className="text-ink/65 hidden items-center gap-2 text-xs xl:inline-flex"
                title={modeTitle}
              >
                <span className="live-dot" />
                {modeLabel}
              </span>
              <div className="hidden md:block">
                <CreateMenu />
              </div>
              <button
                ref={toggle}
                type="button"
                className="border-line-strong grid size-11 place-items-center rounded-xl border md:hidden"
                onClick={() => setMenuOpen((o) => !o)}
                aria-expanded={menuOpen}
                aria-controls="mobile-navigation"
                aria-label={menuOpen ? "Close navigation" : "Open navigation"}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={menuOpen ? "x" : "m"}
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.16 }}
                  >
                    {menuOpen ? <X size={20} /> : <Menu size={20} />}
                  </motion.span>
                </AnimatePresence>
              </button>
            </div>
          </div>
        </header>

        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              id="mobile-navigation"
              aria-label="Mobile navigation"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="bg-ground fixed inset-x-0 top-16 bottom-0 z-30 flex flex-col overflow-auto px-4 pt-4 pb-8 md:hidden"
            >
              <ul className="space-y-1">
                {navigation.map((item, i) => (
                  <motion.li
                    key={item.href}
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{
                      delay: 0.04 + i * 0.04,
                      duration: 0.3,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  >
                    <Link
                      href={item.href}
                      aria-current={
                        isActive(pathname, item.href) ? "page" : undefined
                      }
                      className={`font-display flex min-h-14 items-center rounded-2xl px-4 text-2xl font-semibold tracking-tight ${isActive(pathname, item.href) ? "bg-panel-2 text-ink" : "text-ink/80"}`}
                    >
                      {item.label}
                    </Link>
                  </motion.li>
                ))}
              </ul>
              <div className="mt-6 space-y-3 px-1">
                <p className="text-ink/65 px-3 text-xs font-semibold">
                  New market
                </p>
                {createItems.map(({ href, icon: Icon, title, copy }) => (
                  <Link
                    key={href}
                    href={href}
                    className="border-line-strong hover:bg-panel-2 flex min-h-14 items-center gap-3 rounded-2xl border p-3"
                  >
                    <span className="bg-ice/60 grid size-10 shrink-0 place-items-center rounded-lg">
                      <Icon size={18} />
                    </span>
                    <span>
                      <span className="block text-base font-semibold">
                        {title}
                      </span>
                      <span className="text-ink/70 block text-xs">{copy}</span>
                    </span>
                  </Link>
                ))}
              </div>
              <p
                className="text-ink/65 mt-auto inline-flex items-center gap-2 px-4 pt-8 text-xs"
                title={modeTitle}
              >
                <span className="live-dot" />
                {modeLabel}
              </p>
            </motion.nav>
          )}
        </AnimatePresence>

        <main
          id="main-content"
          className="mx-auto w-full max-w-[1320px] flex-1 px-4 pt-6 pb-16 sm:px-6 lg:px-8"
        >
          {children}
        </main>

        <footer className="border-line border-t">
          <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-6 lg:px-8">
            <Logo />
            <p className="text-ink/65 text-xs">
              TRUTH-402 · Powered by Walrus Memory &amp; Tatum Sui RPC
            </p>
          </div>
        </footer>
      </div>
    </SuiWalletProvider>
  );
}
