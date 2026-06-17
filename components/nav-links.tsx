"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
              active
                ? "bg-brand-light text-brand font-semibold"
                : "text-gray-600 hover:text-brand hover:bg-gray-100"
            }`}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
