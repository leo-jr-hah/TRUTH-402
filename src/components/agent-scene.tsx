"use client";

import { Bot, Coins, Pause, Play, ServerCog } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

const ease = [0.16, 1, 0.3, 1] as const;
const STEP_MS = 2400;

const captions = [
  "Agent asks for report",
  "Server asks 0.01 USDC",
  "Agent pays",
  "Server sends report",
];

function Actor({
  icon: Icon,
  name,
  active,
  animate,
}: {
  icon: typeof Bot;
  name: string;
  active: boolean;
  animate: boolean;
}) {
  return (
    <div className="flex w-20 shrink-0 flex-col items-center gap-2 sm:w-24">
      <motion.div
        animate={animate && active ? { y: [0, -5, 0] } : { y: 0 }}
        transition={{ duration: 0.7, ease }}
        className={`grid size-16 place-items-center rounded-2xl border-2 transition-colors duration-300 sm:size-20 ${
          active
            ? "border-teal bg-navy text-fog"
            : "border-line-strong bg-panel text-ink"
        }`}
      >
        <Icon size={30} aria-hidden="true" />
      </motion.div>
      <span className="text-sm font-semibold">{name}</span>
    </div>
  );
}

function ReportCard() {
  return (
    <div className="border-line-strong bg-panel w-full max-w-[17rem] rounded-2xl border p-4">
      <p className="text-sm font-semibold">Report</p>
      <dl className="mt-3 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-ink text-sm">Crowd</dt>
          <dd className="num text-ink text-lg font-bold">60</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-teal text-sm font-semibold">Track record</dt>
          <dd className="num text-teal text-lg font-bold">66</dd>
        </div>
      </dl>
    </div>
  );
}

function Message({ stage }: { stage: number }) {
  if (stage === 0)
    return (
      <div className="border-line-strong bg-panel rounded-2xl rounded-tl-sm border px-4 py-3 text-sm font-semibold">
        Send me the report
      </div>
    );
  if (stage === 1)
    return (
      <div className="border-teal bg-panel w-full max-w-[17rem] rounded-2xl border-2 p-4">
        <p className="num text-teal text-2xl font-bold">402</p>
        <p className="text-sm font-semibold">Payment required</p>
        <p className="num text-ink/70 mt-1 text-sm">0.01 USDC</p>
      </div>
    );
  if (stage === 2)
    return (
      <div className="border-line-strong bg-panel rounded-2xl rounded-tl-sm border px-4 py-3 text-sm font-semibold">
        Here is the 0.01 USDC
      </div>
    );
  return <ReportCard />;
}

export function AgentScene() {
  const reduce = useReducedMotion() ?? false;
  const [stage, setStage] = useState(0);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (reduce || !playing) return;
    const timer = setInterval(() => setStage((s) => (s + 1) % 4), STEP_MS);
    return () => clearInterval(timer);
  }, [playing, reduce]);

  const shown = reduce ? 3 : stage;
  const fromServer = shown === 1 || shown === 3;

  return (
    <div className="card p-5 sm:p-8">
      <div className="flex items-start justify-between gap-2">
        <Actor
          icon={Bot}
          name="Agent"
          active={reduce || shown === 0 || shown === 2}
          animate={!reduce}
        />

        <div className="relative mt-8 h-1 flex-1 sm:mt-10" aria-hidden="true">
          <span className="border-line-strong absolute inset-x-0 top-0 border-t-2 border-dashed" />
          {!reduce && shown === 2 && (
            <motion.span
              key="coin"
              className="bg-teal text-fog absolute top-0 grid size-9 -translate-y-1/2 place-items-center rounded-full"
              initial={{ left: "0%", opacity: 1, scale: 1 }}
              animate={{ left: ["0%", "88%"], opacity: [1, 1], scale: 1 }}
              transition={{ duration: STEP_MS / 1000 - 0.3, ease }}
            >
              <Coins size={18} />
            </motion.span>
          )}
          {reduce && (
            <span className="bg-teal text-fog absolute top-0 left-1/2 grid size-9 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full">
              <Coins size={18} />
            </span>
          )}
        </div>

        <Actor
          icon={ServerCog}
          name="Server"
          active={reduce || shown === 1 || shown === 3}
          animate={!reduce}
        />
      </div>

      <div
        className={`mt-5 flex min-h-[8.5rem] sm:min-h-[7.5rem] ${fromServer || reduce ? "justify-end" : "justify-start"}`}
        aria-live="off"
      >
        {reduce ? (
          <ReportCard />
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={shown}
              initial={{ opacity: 0, x: fromServer ? 40 : -40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              transition={{ duration: 0.5, ease }}
              className="flex w-full items-start"
              style={{ justifyContent: fromServer ? "flex-end" : "flex-start" }}
            >
              <Message stage={shown} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <ol className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
          {captions.map((text, i) => {
            const lit = reduce || i === shown;
            return (
              <li key={text}>
                <button
                  type="button"
                  disabled={reduce}
                  onClick={() => {
                    setStage(i);
                    setPlaying(false);
                  }}
                  aria-current={lit && !reduce ? "step" : undefined}
                  className={`min-h-11 w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors duration-300 ${
                    lit
                      ? "border-teal text-ink bg-ice/40 font-semibold"
                      : "border-line text-ink/70 hover:border-line-strong"
                  }`}
                >
                  <span className="num text-teal mr-1.5">{i + 1}</span>
                  {text}
                </button>
              </li>
            );
          })}
        </ol>
        {!reduce && (
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            aria-label={playing ? "Pause animation" : "Play animation"}
            className="border-line-strong hover:border-ink grid size-11 shrink-0 place-items-center rounded-xl border transition-colors active:scale-90"
          >
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>
        )}
      </div>
    </div>
  );
}
