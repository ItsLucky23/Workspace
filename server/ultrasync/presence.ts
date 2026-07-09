//? Y1 — activity-presence CORE (the Google-Docs-style "who is where + active/idle"). Pure status + aggregation
//? over the ephemeral presence relay (userId from the session, never spoofable — patterned on presence_server_v1).
//? A user is ACTIVE when they interacted <60s ago, IDLE until 5min, AWAY after (disconnect/heartbeat gap). The
//? UI (navbar per-view counts + per-page active-vs-passive) renders this; the DOM-streaming watch engine (Y2) +
//? the overlay + follow-mode + the `ultrasync.watch` RBAC role + real pixel-share (Y3) are the browser round.
//? GEEN live cursor-streaming in v1 (per-input-live = v2). Injectable `now` → deterministic.

export type PresenceStatus = 'active' | 'idle' | 'away';

const ACTIVE_MS = 60_000;      // interaction within a minute → active
const IDLE_MS = 5 * 60_000;    // then idle, until 5 minutes → away

//? Resolve a user's status from their last-interaction timestamp (ms) relative to `now`. `editing` (currently
//? mutating something) forces 'active' regardless of the clock — a live edit is the strongest signal.
export function resolvePresenceStatus(lastInteractionMs: number, now: number, editing = false): PresenceStatus {
  if (editing) return 'active';
  const age = now - lastInteractionMs;
  if (age <= ACTIVE_MS) return 'active';
  if (age <= IDLE_MS) return 'idle';
  return 'away';
}

//? A raw presence entry from the relay: who, which view/page, whether they are editing, and their last-seen ms.
export interface PresenceEntry { userId: string; view: string; editing: boolean; lastMs: number }

export interface ViewPresence { view: string; users: { userId: string; status: PresenceStatus; editing: boolean }[]; activeCount: number }

//? Aggregate the relay entries into per-view presence (the navbar/page render): each view lists its users with
//? their resolved status; `activeCount` powers the "N users on page X" badge. AWAY users are dropped (gone).
//? Latest entry per (user,view) wins. Pure — inject `now`.
export function aggregatePresence(entries: PresenceEntry[], now: number): ViewPresence[] {
  //? Keep the most-recent entry per user+view.
  const latest = new Map<string, PresenceEntry>();
  for (const e of entries) {
    const key = `${e.userId}|${e.view}`;
    const prev = latest.get(key);
    if (!prev || e.lastMs > prev.lastMs) latest.set(key, e);
  }
  const byView = new Map<string, { userId: string; status: PresenceStatus; editing: boolean }[]>();
  for (const e of latest.values()) {
    const status = resolvePresenceStatus(e.lastMs, now, e.editing);
    if (status === 'away') continue; // gone → not shown
    const list = byView.get(e.view) ?? [];
    list.push({ userId: e.userId, status, editing: e.editing });
    byView.set(e.view, list);
  }
  return [...byView.entries()].map(([view, users]) => ({ view, users, activeCount: users.filter((u) => u.status === 'active').length }));
}
