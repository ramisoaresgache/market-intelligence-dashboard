"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./app-nav.module.css";

const links = [
  { href: "/", label: "Mercado" },
  { href: "/macro", label: "Macro & Noticias" },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <div className={styles.shell}>
      <nav className={styles.nav} aria-label="Navegación principal">
        <Link className={styles.brand} href="/">
          <span className={styles.brandMark}>MI</span>
          <span>
            <b>Market Intelligence</b>
            <small>dashboard</small>
          </span>
        </Link>
        <div className={styles.links}>
          {links.map((link) => {
            const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link key={link.href} href={link.href} className={active ? styles.active : ""}>
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
