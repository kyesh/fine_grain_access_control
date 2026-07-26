'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Top-nav link. The active route is marked with the primary color and a heavier
 * weight, matching the design — `/dashboard` only counts as active on an exact
 * match so it does not stay lit while you are on `/dashboard/accounts`.
 */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={
        isActive
          ? 'text-sm font-semibold text-primary'
          : 'text-sm font-medium text-muted-foreground hover:text-foreground'
      }
    >
      {children}
    </Link>
  );
}
