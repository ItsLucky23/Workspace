//? Workspaces — the tabular/label half of the shared layer.
//?
//? WHY THIS FILE EXISTS: thirteen-plus pages (insights/usage, insights/knowledge,
//? content/scheduled-posts, ChannelsTab, AdminTab, MrReviewPanel, the board header) each
//? hand-built their own table out of divs. Nothing shared defined header weight, row hover, the
//? divider convention or `tabular-nums`, so numeric columns misaligned digit by digit, every
//? table drifted to a different visual weight, and several of them pushed the PAGE sideways on a
//? phone instead of scrolling inside themselves. One dumb, typed table fixes all of that at once.
//?
//? Deliberately dumb: no sorting, no pagination, no selection. Nobody asked for those, and every
//? one of them would need product decisions (what is the default sort? is it persisted?) that the
//? shared layer has no business making.

import { type ReactNode } from 'react';

import { useTranslator } from '@luckystack/core/client';

/** One column. `cell` receives the row, so a column can render a chip/button, not just text. */
export interface TableColumn<T> {
  id: string;
  header: ReactNode;
  /** `right` also switches the column to tabular figures — see the `numeric` note on Table. */
  align?: 'left' | 'right';
  /** Optional width utility (`w-32`, `min-w-[12rem]`); omit to let the column size to its content. */
  className?: string;
  cell: (row: T) => ReactNode;
}

export function Table<T>({ columns, rows, rowKey, empty, maxHeightClass, className = '' }: {
  columns: TableColumn<T>[];
  rows: T[];
  /** Stable identity per row — never the array index, or a re-ordered list re-uses DOM state. */
  rowKey: (row: T) => string;
  /** Replaces the default one-liner when the caller has something more useful to say. */
  empty?: ReactNode;
  /** e.g. `max-h-96` — makes the sticky header do its job by giving the body somewhere to scroll. */
  maxHeightClass?: string;
  className?: string;
}) {
  const translate = useTranslator();
  if (rows.length === 0) {
    return (
      <div className={`rounded-xl border border-container1-border bg-container1 px-4 py-8 text-center text-sm text-muted ${className}`}>
        {empty ?? translate({ key: 'workspaces.common.tableEmpty' })}
      </div>
    );
  }
  return (
    //? The horizontal scroll is CONTAINED here. A wide table is normal; a page that scrolls
    //? sideways on a phone is the defect, and it is what every hand-built table did.
    <div className={`overflow-x-auto ${maxHeightClass ?? ''} rounded-xl border border-container1-border bg-container1 ${className}`}>
      <table className={`w-full border-collapse text-sm`}>
        <thead>
          {/* Sticky needs an opaque background of its own, otherwise rows scroll through it. */}
          <tr className={`sticky top-0 z-10 bg-container1`}>
            {columns.map((c) => (
              <th
                key={c.id} scope="col"
                className={`border-b border-divider px-3 py-2 text-xs font-semibold text-meta whitespace-nowrap ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.className ?? ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            //? No zebra striping: hairline dividers + a hover tint separate rows without adding a
            //? second background colour that fights the surface tokens.
            <tr key={rowKey(row)} className={`transition-colors duration-150 hover:bg-container2/60`}>
              {columns.map((c) => (
                <td
                  key={c.id}
                  //? tabular-nums on right-aligned columns: proportional digits change width as a
                  //? live counter ticks, which makes realtime numbers visibly jitter.
                  className={`border-b border-divider/60 px-3 py-2 text-common align-middle ${c.align === 'right' ? 'text-right tabular-nums' : 'text-left'} ${c.className ?? ''}`}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

//? WHY: /docs repeats one hand-written `text-[10px] font-bold uppercase tracking-wider` label about
//? twenty times as its ONLY hierarchy — at 40% opacity, which is decorative-grade contrast on text
//? that is real content. One primitive gives every such label the same size and the readable `meta`
//? token, and gives other pages something to reach for instead of inventing a twenty-first variant.
export function SectionLabel({ children, count, className = '' }: { children: ReactNode; count?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className={`text-[10px] font-semibold uppercase tracking-wider text-meta`}>{children}</span>
      {count != null && (
        <span className={`rounded-full bg-container2 px-1.5 text-[10px] font-semibold tabular-nums text-meta`}>{count}</span>
      )}
    </div>
  );
}
