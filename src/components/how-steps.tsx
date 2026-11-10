"use client";

import { ArrowRight } from "lucide-react";
import { useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { HowStage } from "@/components/how-stage";
import { WorkedExample } from "@/components/worked-example";

const STEPS = [
  {
    title: "People bet",
    text: "Each bet moves the Crowd number, like a live vote.",
  },
  {
    title: "The market ends",
    text: "The result comes in, and we check who was right.",
  },
  {
    title: "We remember",
    text: "We save each record, and good records earn bigger bubbles.",
  },
  {
    title: "Next market, smarter",
    text: "New bets count more when the person has a good record.",
  },
  {
    title: "Agents can buy it",
    text: "AI agents pay 0.01 USDC and get the report back.",
  },
];

function Dots({
  active,
  onPick,
  className = "",
}: {
  active: number;
  onPick: (i: number) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Steps" className={className}>
      <ol className="flex items-center justify-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => onPick(i)}
              aria-label={`Step ${i + 1}: ${s.title}`}
              aria-current={active === i ? "step" : undefined}
              className="group grid h-6 place-items-center px-0.5"
            >
              <span
                className={`block h-2 rounded-full transition-all duration-500 ${
                  active === i
                    ? "bg-teal w-8"
                    : "bg-line-strong group-hover:bg-ink w-2"
                }`}
              />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function HowSteps() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const i = refs.current.indexOf(e.target as HTMLElement);
            if (i >= 0) setActive(i);
          }
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const jump = (i: number) => {
    setActive(i);
    refs.current[i]?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "center",
    });
  };

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
      <div className="hidden lg:block">
        <div className="sticky top-24 flex h-[calc(100vh-8rem)] min-h-[560px] flex-col justify-center gap-5">
          <HowStage step={active + 1} />
          <Dots active={active} onPick={jump} />
        </div>
      </div>
      <div>
        {STEPS.map((s, i) => (
          <article
            key={s.title}
            ref={(el) => {
              refs.current[i] = el;
            }}
            data-step={i + 1}
            className="flex flex-col justify-center py-10 lg:min-h-[85vh] lg:py-16"
          >
            <div className="lg:hidden">
              <HowStage step={i + 1} />
            </div>
            {i === 4 && <span id="agent-payments" aria-hidden="true" />}
            <h2 className="mt-6 text-3xl sm:text-4xl lg:mt-0">{s.title}</h2>
            <p className="mt-3 max-w-md text-lg opacity-80">{s.text}</p>
            {i === 3 && <WorkedExample />}
            {i === 4 && (
              <div className="mt-8">
                <Link href="/markets" className="button-primary">
                  Explore markets
                  <ArrowRight size={17} aria-hidden="true" />
                </Link>
              </div>
            )}
          </article>
        ))}
        <Dots
          active={active}
          onPick={jump}
          className="bg-panel border-line sticky bottom-3 z-10 mx-auto w-fit rounded-full border px-3 py-1 lg:hidden"
        />
      </div>
    </div>
  );
}
