"use client";

import { useId, useState } from "react";

const CROWD = 60;
const TRACK = 66;

/** Small example: blend the two numbers with a slider. */
export function WorkedExample() {
  const [weight, setWeight] = useState(50);
  const id = useId();
  const blended = CROWD + ((TRACK - CROWD) * weight) / 100;

  return (
    <div className="border-line bg-panel mt-6 rounded-2xl border p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold">
          How much should track record count?
        </label>
        <span className="sticker">Example</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={weight}
        onChange={(e) => setWeight(Number(e.target.value))}
        aria-valuetext={`${weight} percent`}
        className="accent-teal mt-4 h-6 w-full"
      />
      <div className="num flex justify-between text-xs opacity-70">
        <span>Not at all</span>
        <span className="text-ink font-semibold opacity-100">{weight}%</span>
        <span>Fully</span>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="border-line rounded-xl border px-2 py-2.5">
          <dt className="text-xs opacity-70">Crowd</dt>
          <dd className="num text-xl font-bold">{CROWD}%</dd>
        </div>
        <div className="border-line rounded-xl border px-2 py-2.5">
          <dt className="text-teal text-xs">Track record</dt>
          <dd className="num text-teal text-xl font-bold">{TRACK}%</dd>
        </div>
        <div className="bg-navy text-fog rounded-xl px-2 py-2.5">
          <dt className="text-xs opacity-80">Blended</dt>
          <dd className="num text-xl font-bold" aria-live="polite">
            {blended.toFixed(1)}%
          </dd>
        </div>
      </dl>
    </div>
  );
}
