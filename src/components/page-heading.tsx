"use client";

import { motion, useReducedMotion } from "motion/react";

import { Disclosure } from "@/components/ui/disclosure";

const ease = [0.16, 1, 0.3, 1] as const;
const spring = { type: "spring", stiffness: 420, damping: 36 } as const;

/** `eyebrow` is accepted for call-site compatibility but never rendered. */
export function PageHeading({
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const words = title.split(" ");

  // Preserve the full description without crowding the primary heading.
  const descriptionNeedsDetails = description
    ? description.trim().split(/\s+/).length >= 14 ||
      /\b(?:memory[\s-]+calibrated|oracle|shrinkage|alpha|t[\s-]*score)\b/i.test(
        description,
      )
    : false;

  return (
    <div className="text-ink flex min-w-0 flex-col justify-between gap-5 font-sans sm:flex-row sm:flex-wrap sm:items-start sm:gap-8">
      <div className="max-w-4xl min-w-0 sm:flex-[1_1_20rem]">
        <h1
          aria-label={title}
          className="font-display text-ink max-w-full text-[2rem] leading-[1.08] font-[650] tracking-[-0.035em] sm:text-[2.75rem] lg:text-5xl"
        >
          {words.map((word, i) => (
            <span
              key={`${word}-${i}`}
              aria-hidden
              className="inline-block max-w-full overflow-hidden pb-[0.12em] align-top"
            >
              <motion.span
                className="inline-block max-w-full [overflow-wrap:anywhere]"
                initial={reduceMotion ? false : { y: "105%", rotate: 1 }}
                animate={{ y: 0, rotate: 0 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : {
                        duration: 0.55,
                        delay: 0.04 + Math.min(i, 8) * 0.035,
                        ease,
                      }
                }
              >
                {word}
                {i < words.length - 1 ? "\u00a0" : ""}
              </motion.span>
            </span>
          ))}
        </h1>

        {description && (
          <motion.div
            className="mt-2 max-w-xl"
            initial={reduceMotion ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.45, delay: 0.18, ease }
            }
          >
            {descriptionNeedsDetails ? (
              <Disclosure
                summary="Details"
                className="card [&>button:hover]:bg-panel-2 [&>button:active]:bg-panel-2 [&>button]:min-h-11 [&>button]:rounded-[19px] motion-reduce:[&>div]:h-auto!"
              >
                <p className="text-ink/70 text-sm leading-6 [overflow-wrap:anywhere]">
                  {description}
                </p>
              </Disclosure>
            ) : (
              <p className="text-ink/70 text-[0.95rem] leading-6 [overflow-wrap:anywhere] sm:text-base">
                {description}
              </p>
            )}
          </motion.div>
        )}
      </div>

      {action && (
        <motion.div
          className="flex max-w-full min-w-0 flex-wrap items-center gap-2 sm:shrink-0 sm:pt-1"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={
            reduceMotion ? { duration: 0 } : { ...spring, delay: 0.18 }
          }
        >
          {action}
        </motion.div>
      )}
    </div>
  );
}
