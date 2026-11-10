// Pulls active, near-term binary markets from the Tatum Prediction API into src/lib/live-markets.json.
import { readFileSync, writeFileSync } from "node:fs";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.split("=")[0], l.slice(l.indexOf("=") + 1)]),
);
const key = process.env.TATUM_API_KEY || env.TATUM_API_KEY;
const now = Date.now();
const horizon = now + 75 * 864e5;
const all = [];
let cursor = "";
for (let page = 0; page < 25; page++) {
  const r = await fetch(
    `https://api.tatum.io/v4/data/prediction/markets?limit=100&status=active${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    { headers: { "x-api-key": key } },
  );
  if (!r.ok) break;
  const j = await r.json();
  all.push(...(j.data || []));
  cursor = j.pagination?.cursor;
  if (!cursor || !j.data?.length) break;
}
const ok = all.filter(
  (m) =>
    m.status === "active" &&
    m.outcomes?.length === 2 &&
    m.closeTime &&
    new Date(m.closeTime) > now &&
    new Date(m.closeTime) < horizon &&
    Number(m.volume) > 20000 &&
    m.outcomes[0].price > 0.04 &&
    m.outcomes[0].price < 0.96,
);
const bucket = (m) => {
  const t =
    (m.tags || []).join(" ").toLowerCase() + " " + m.question.toLowerCase();
  return /nba|nfl|soccer|sports|football|ufc|f1|tennis|mlb|nhl|cup|league/.test(
    t,
  )
    ? "sports"
    : /bitcoin|btc|eth|crypto|solana/.test(t)
      ? "crypto"
      : /election|president|senate|trump|politic|congress|governor/.test(t)
        ? "politics"
        : /fed|rate|inflation|gdp|recession|economy|oil/.test(t)
          ? "macro"
          : "world";
};
const seen = new Map(),
  picks = [];
for (const m of ok.sort((a, b) => Number(b.volume) - Number(a.volume))) {
  const b = bucket(m);
  if ((seen.get(b) || 0) >= 7) continue;
  seen.set(b, (seen.get(b) || 0) + 1);
  picks.push({
    id: `live-${m.id.slice(2, 14)}`,
    title: m.question,
    description: (m.description || "").slice(0, 400),
    category: b,
    closesAt: m.closeTime,
    yesPrice: Number(m.outcomes[0].price),
    volumeUsd: Math.round(Number(m.volume)),
  });
  if (picks.length >= 25) break;
}
writeFileSync(
  new URL("../src/lib/live-markets.json", import.meta.url),
  JSON.stringify(
    { fetchedAt: new Date().toISOString(), markets: picks },
    null,
    2,
  ) + "\n",
);
console.log(all.length, "fetched;", picks.length, "picked", [...seen]);
for (const p of picks)
  console.log(
    p.category,
    "|",
    p.title.slice(0, 70),
    "|",
    p.closesAt.slice(0, 10),
    "|",
    p.yesPrice,
  );
