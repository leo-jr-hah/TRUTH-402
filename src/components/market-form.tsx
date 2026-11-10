"use client";

import { ArrowLeft, Check, CircleAlert, Loader2, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { MarketCard } from "@/components/market-card";
import { Disclosure } from "@/components/ui/disclosure";
import { Select } from "@/components/ui/select";
import { removeEmDashes } from "@/lib/sanitize";
import type { Market, MarketType } from "@/types/domain";

interface DraftOutcome {
  key: string;
  label: string;
  submitter: string;
}

interface ApiError {
  error?: {
    message?: string;
    details?: {
      issues?: Array<{ path: PropertyKey[]; message: string }>;
    };
  };
}

type Errors = Record<string, string>;
type Phase = "idle" | "submitting" | "done";

const ease = [0.16, 1, 0.3, 1] as const;

function makeOutcome(): DraftOutcome {
  return { key: crypto.randomUUID(), label: "", submitter: "" };
}

function lengthError(
  value: string,
  min: number,
  max: number,
  noun: string,
): string | null {
  const v = value.trim();
  if (v.length === 0) return `${noun} is required.`;
  if (v.length < min) return `${noun} needs at least ${min} characters.`;
  if (value.length > max) return `${noun} can be at most ${max} characters.`;
  return null;
}

const sensitivityOptions = [
  { value: "120", label: "Fast", hint: "Prices move quickly" },
  { value: "250", label: "Balanced", hint: "Recommended" },
  { value: "500", label: "Slow", hint: "Prices move gently" },
];

function FieldError({ message, id }: { message?: string; id: string }) {
  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.p
          key={message}
          id={id}
          role="alert"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.22, ease }}
          className="text-ink overflow-hidden text-xs font-semibold"
        >
          <span className="flex items-center gap-1.5 pt-1.5">
            <CircleAlert size={13} aria-hidden />
            {message}
          </span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}

export function MarketForm({
  type,
  operatorRequired = false,
}: {
  type: MarketType;
  operatorRequired?: boolean;
}) {
  const opportunity = type === "opportunity";
  const minimumOutcomes = opportunity ? 3 : 2;
  const maximumOutcomes = opportunity ? 12 : 5;
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [tags, setTags] = useState("");
  const [liquidity, setLiquidity] = useState(250);
  const [outcomes, setOutcomes] = useState<DraftOutcome[]>(() =>
    Array.from({ length: minimumOutcomes }, makeOutcome),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [operatorToken, setOperatorToken] = useState("");
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  const submitting = phase !== "idle";
  const touch = (key: string) =>
    setTouched((cur) => (cur.has(key) ? cur : new Set(cur).add(key)));

  const errors = useMemo<Errors>(() => {
    const e: Errors = {};
    const t = lengthError(title, 8, 140, "The question");
    if (t) e.title = t;
    const d = lengthError(description, 20, 1500, "The context");
    if (d) e.description = d;
    const s = lengthError(sponsor, 2, 100, "The owner");
    if (s) e.sponsor = s;
    for (const o of outcomes) {
      const l = lengthError(o.label, 2, 80, "This option");
      if (l) e[`o:${o.key}:label`] = l;
      if (opportunity) {
        const sub = lengthError(o.submitter, 2, 80, "The submitter");
        if (sub) e[`o:${o.key}:submitter`] = sub;
      }
    }
    const names = outcomes.map((o) => o.label.trim().toLowerCase());
    outcomes.forEach((o, i) => {
      const n = names[i];
      if (n && names.indexOf(n) !== i && !e[`o:${o.key}:label`])
        e[`o:${o.key}:label`] = "Each option needs its own name.";
    });
    return e;
  }, [title, description, sponsor, outcomes, opportunity]);
  const shown: Errors = Object.fromEntries(
    Object.entries(errors).filter(([k]) => showAll || touched.has(k)),
  );
  const errorCount = Object.keys(errors).length;

  const preview = useMemo<Market>(() => {
    const now = new Date().toISOString();
    const price = 1 / Math.max(outcomes.length, 1);
    return {
      id: "preview",
      type,
      title: title.trim() || "Your question appears here",
      description,
      sponsor,
      status: "open",
      outcomes: outcomes.map((o, i) => ({
        id: o.key,
        label: o.label.trim() || `Option ${i + 1}`,
        shares: 0,
        price,
        volume: 0,
      })),
      liquidity,
      totalVolume: 0,
      trades: [],
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      createdAt: now,
      updatedAt: now,
      memoryStatus: "not_started",
      memoryReceipts: [],
    };
  }, [type, title, description, sponsor, outcomes, liquidity, tags]);

  function updateOutcome(key: string, patch: Partial<DraftOutcome>) {
    setOutcomes((cur) =>
      cur.map((o) => (o.key === key ? { ...o, ...patch } : o)),
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    if (errorCount > 0) {
      setShowAll(true);
      setError(null);
      setTimeout(() => {
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus();
      }, 30);
      return;
    }
    setPhase("submitting");
    setError(null);

    try {
      const response = await fetch("/api/markets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(operatorToken
            ? { authorization: `Bearer ${operatorToken}` }
            : {}),
        },
        body: JSON.stringify({
          type,
          title,
          description,
          sponsor,
          outcomes: outcomes.map((o) => ({
            label: o.label,
            submitter: opportunity ? o.submitter || undefined : undefined,
          })),
          liquidity,
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as { market?: Market } & ApiError;
      if (!response.ok || !payload.market) {
        const issue = payload.error?.details?.issues?.[0]?.message;
        throw new Error(
          issue || payload.error?.message || "The market could not be created.",
        );
      }
      setPhase("done");
      const id = payload.market.id;
      setTimeout(() => {
        router.push(`/markets/${id}`);
        router.refresh();
      }, 900);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? removeEmDashes(caught.message)
          : "The market could not be created.",
      );
      setPhase("idle");
    } finally {
      setOperatorToken("");
    }
  }

  const itemLabel = opportunity ? "proposal" : "option";

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      noValidate
      className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_340px]"
    >
      <div className="max-w-2xl space-y-7 lg:col-start-1">
        <div>
          <label htmlFor="mf-title" className="field-label">
            Question
          </label>
          <input
            id="mf-title"
            className={`field ${shown.title ? "field-error" : ""}`}
            aria-invalid={!!shown.title}
            aria-describedby={shown.title ? "err-title" : undefined}
            maxLength={140}
            value={title}
            onBlur={() => touch("title")}
            onChange={(e) => setTitle(removeEmDashes(e.target.value))}
            placeholder={
              opportunity
                ? "Which proposal should get the grant?"
                : "Which concept should we ship first?"
            }
          />
          <FieldError id="err-title" message={shown.title} />
          <p className="num text-ink/65 mt-1.5 text-right text-xs">
            {title.length}/140
          </p>
        </div>

        <fieldset>
          <legend className="field-label">
            {opportunity ? "Proposals" : "Options"}{" "}
            <span className="text-ink/65 font-normal">
              ({minimumOutcomes} to {maximumOutcomes})
            </span>
          </legend>
          <ul
            className={`m-0 list-none p-0 ${opportunity ? "space-y-3" : "space-y-2"}`}
          >
            <AnimatePresence initial={false}>
              {outcomes.map((o, i) => {
                const le = shown[`o:${o.key}:label`];
                const se = shown[`o:${o.key}:submitter`];
                return (
                  <motion.li
                    key={o.key}
                    layout="position"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.28, ease }}
                    className="overflow-hidden"
                  >
                    <div className="flex items-start gap-2 py-0.5">
                      <div
                        className={`grid min-w-0 flex-1 gap-2 ${opportunity ? "sm:grid-cols-2" : ""}`}
                      >
                        <div>
                          <input
                            className={`field ${le ? "field-error" : ""}`}
                            aria-label={`${opportunity ? "Proposal" : "Option"} ${i + 1} name`}
                            aria-invalid={!!le}
                            aria-describedby={le ? `${o.key}-l` : undefined}
                            maxLength={80}
                            value={o.label}
                            onBlur={() => touch(`o:${o.key}:label`)}
                            onChange={(e) =>
                              updateOutcome(o.key, {
                                label: removeEmDashes(e.target.value),
                              })
                            }
                            placeholder={
                              opportunity
                                ? `Proposal ${i + 1}`
                                : i === 0
                                  ? "Yes"
                                  : i === 1
                                    ? "No"
                                    : `Option ${i + 1}`
                            }
                          />
                          <FieldError id={`${o.key}-l`} message={le} />
                        </div>
                        {opportunity && (
                          <div>
                            <input
                              className={`field ${se ? "field-error" : ""}`}
                              aria-label={`Proposal ${i + 1} submitted by`}
                              aria-invalid={!!se}
                              aria-describedby={se ? `${o.key}-s` : undefined}
                              maxLength={80}
                              value={o.submitter}
                              onBlur={() => touch(`o:${o.key}:submitter`)}
                              onChange={(e) =>
                                updateOutcome(o.key, {
                                  submitter: removeEmDashes(e.target.value),
                                })
                              }
                              placeholder="Submitted by"
                            />
                            <FieldError id={`${o.key}-s`} message={se} />
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="text-ink/65 hover:bg-panel-2 hover:text-ink grid size-11 shrink-0 place-items-center rounded-xl transition-colors disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                        disabled={outcomes.length <= minimumOutcomes}
                        onClick={() =>
                          setOutcomes((cur) =>
                            cur.filter((c) => c.key !== o.key),
                          )
                        }
                        aria-label={`Remove ${itemLabel} ${i + 1}`}
                      >
                        <X size={17} />
                      </button>
                    </div>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
          <button
            type="button"
            className="button-secondary mt-2 w-full border-dashed"
            disabled={outcomes.length >= maximumOutcomes}
            onClick={() => setOutcomes((cur) => [...cur, makeOutcome()])}
          >
            <Plus size={17} />
            Add {itemLabel}
            <span className="num text-ink/65 text-xs">
              {outcomes.length}/{maximumOutcomes}
            </span>
          </button>
        </fieldset>

        <div>
          <label htmlFor="mf-desc" className="field-label">
            Context
          </label>
          <textarea
            id="mf-desc"
            className={`textarea ${shown.description ? "field-error" : ""}`}
            aria-invalid={!!shown.description}
            aria-describedby={shown.description ? "err-desc" : undefined}
            maxLength={1500}
            value={description}
            onBlur={() => touch("description")}
            onChange={(e) => setDescription(removeEmDashes(e.target.value))}
            placeholder="What should traders know before they pick?"
          />
          <FieldError id="err-desc" message={shown.description} />
        </div>

        <div>
          <label htmlFor="mf-sponsor" className="field-label">
            Owner
          </label>
          <input
            id="mf-sponsor"
            className={`field ${shown.sponsor ? "field-error" : ""}`}
            aria-invalid={!!shown.sponsor}
            aria-describedby={shown.sponsor ? "err-sponsor" : undefined}
            maxLength={100}
            value={sponsor}
            onBlur={() => touch("sponsor")}
            onChange={(e) => setSponsor(removeEmDashes(e.target.value))}
            placeholder="Team or person who makes the final call"
          />
          <FieldError id="err-sponsor" message={shown.sponsor} />
        </div>

        <Disclosure summary="More options">
          <div className="space-y-5 px-4 pt-1 pb-4">
            <div>
              <label htmlFor="mf-tags" className="field-label">
                Tags <span className="text-ink/65 font-normal">(optional)</span>
              </label>
              <input
                id="mf-tags"
                className="field"
                value={tags}
                onChange={(e) => setTags(removeEmDashes(e.target.value))}
                placeholder="crypto, sports"
              />
              <p className="text-ink/65 mt-1.5 text-xs">
                Up to five, separated by commas. Sports and crypto set the
                category.
              </p>
            </div>
            <div>
              <span className="field-label">Price speed</span>
              <Select
                label="Price speed"
                value={String(liquidity)}
                onChange={(v) => setLiquidity(Number(v))}
                options={sensitivityOptions}
              />
            </div>
          </div>
        </Disclosure>

        {operatorRequired && (
          <div>
            <label htmlFor="mf-token" className="field-label">
              Operator token
            </label>
            <input
              id="mf-token"
              type="password"
              autoComplete="off"
              className="field"
              value={operatorToken}
              onChange={(e) => setOperatorToken(e.target.value)}
              placeholder="Required to create markets"
            />
          </div>
        )}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <p className="text-sm font-semibold">Preview</p>
        <MarketCard market={preview} inert />
        <p className="text-ink/65 text-xs">
          Every option starts level. Trades move the price.
        </p>
      </aside>

      <div className="max-w-2xl space-y-4 lg:col-start-1">
        <AnimatePresence initial={false}>
          {(error || (showAll && errorCount > 0)) && (
            <motion.div
              key={error ?? "invalid"}
              role="alert"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease }}
              className="border-ink bg-panel flex items-start gap-3 rounded-xl border px-4 py-3 text-sm"
            >
              <CircleAlert size={18} className="mt-0.5 shrink-0" />
              <span className="font-semibold">
                {error ??
                  `${errorCount} ${errorCount === 1 ? "field needs" : "fields need"} a fix before you can create this.`}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/markets/new" className="button-ghost">
            <ArrowLeft size={16} />
            Change format
          </Link>
          <button
            type="submit"
            className="button-primary min-w-48"
            disabled={submitting || (operatorRequired && !operatorToken)}
            aria-live="polite"
          >
            {phase === "idle" && "Create market"}
            {phase === "submitting" && (
              <>
                <Loader2 size={17} className="animate-spin" /> Creating...
              </>
            )}
            {phase === "done" && (
              <>
                <Check size={18} strokeWidth={3} /> Market created
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}
