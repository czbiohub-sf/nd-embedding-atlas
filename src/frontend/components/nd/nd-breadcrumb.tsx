/**
 * NdBreadcrumb — graph-level path (atlas › qc › …). shadcn anatomy
 * (nav > ol > li, chevron separators): muted links, current page in
 * primary text, mono 9.5px. Used in the wiring header and the canvas HUD.
 */

import { Fragment } from "react";

export interface NdCrumb {
  label: string;
  onClick?: () => void;
}

function Chevron() {
  return (
    <svg width="7" height="7" viewBox="0 0 10 10" className="block opacity-45">
      <path d="M3.5 1.5 L7 5 L3.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function NdBreadcrumb({ items, size = 9.5 }: { items: NdCrumb[]; size?: number }) {
  return (
    <nav aria-label="breadcrumb" className="inline-flex min-w-0" data-nodrag="1">
      <ol
        className="m-0 flex min-w-0 list-none items-center gap-[5px] p-0 font-mono tabular-nums text-text-muted"
        style={{ fontSize: size }}
      >
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <Fragment key={`${it.label}-${i}`}>
              {i > 0 ? (
                <li aria-hidden="true" className="flex shrink-0">
                  <Chevron />
                </li>
              ) : null}
              <li className="flex min-w-0">
                {last || !it.onClick ? (
                  <span
                    aria-current={last ? "page" : undefined}
                    className={last ? "truncate whitespace-nowrap text-foreground" : "truncate whitespace-nowrap"}
                  >
                    {it.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      it.onClick?.();
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 font-mono text-inherit hover:text-foreground"
                    style={{ fontSize: size }}
                  >
                    {it.label}
                  </button>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
