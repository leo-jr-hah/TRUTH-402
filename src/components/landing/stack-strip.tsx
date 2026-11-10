import { ArrowRight, CreditCard, Database, Server } from "lucide-react";
import Link from "next/link";

const stackItems = [
  {
    name: "Walrus Memory",
    description: "62 learning records, shrinkage weighting",
    href: "/insights",
    icon: Database,
  },
  {
    name: "Tatum Sui RPC",
    description: "Checkpoint stamps and receipt checks",
    href: "/integrations",
    icon: Server,
  },
  {
    name: "Sui HTTP 402",
    description: "0.01 USDC per report, single use",
    href: "/integrations",
    icon: CreditCard,
  },
] as const;

export function StackStrip() {
  return (
    <div className="divide-line border-line bg-panel text-ink grid divide-y overflow-hidden rounded-2xl border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
      {stackItems.map(({ name, description, href, icon: Icon }) => (
        <Link
          key={name}
          href={href}
          className="group hover:bg-ice/40 focus-visible:bg-ice/40 focus-visible:outline-teal flex min-w-0 items-center gap-3 p-4 transition-colors duration-200 focus-visible:outline-2 focus-visible:-outline-offset-2 motion-reduce:transition-none"
        >
          <Icon size={18} className="text-teal shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm leading-5 font-bold">{name}</span>
            <span
              className="text-ink/70 mt-0.5 block truncate text-xs leading-4"
              title={description}
            >
              {description}
            </span>
          </span>
          <ArrowRight
            size={16}
            aria-hidden="true"
            className="text-teal shrink-0 transition-transform duration-200 group-hover:translate-x-1 group-focus-visible:translate-x-1 motion-reduce:transform-none motion-reduce:transition-none"
          />
        </Link>
      ))}
    </div>
  );
}
