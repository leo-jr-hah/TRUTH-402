import Link from "next/link";

/** The mark: a T whose stem is a pair of tusks. Tusks sway on hover. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className="overflow-visible"
    >
      <rect x="3" y="4" width="26" height="6" rx="3" fill="var(--ink)" />
      <g className="origin-[16px_10px] transition-transform duration-500 ease-[var(--ease-spring)] group-hover:rotate-[-8deg]">
        <path
          d="M11 10c0 8 1 13 4 17"
          stroke="var(--teal)"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      </g>
      <g className="origin-[16px_10px] transition-transform duration-500 ease-[var(--ease-spring)] group-hover:rotate-[8deg]">
        <path
          d="M21 10c0 8-1 13-4 17"
          stroke="var(--teal)"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className="group inline-flex items-center gap-2.5 rounded-lg"
      aria-label="TRUTH-402 home"
    >
      <LogoMark />
      {!compact && (
        <span className="font-display text-ink text-[1.2rem] font-extrabold tracking-[-0.03em]">
          TRUTH<span className="text-teal">402</span>
        </span>
      )}
    </Link>
  );
}
