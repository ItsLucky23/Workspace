//? intent: Interviewer — ask the AI anything about THIS codebase and think through new plans
//? together. It has repo context (via the Workspace-AI), so you can ask "how does the auth flow
//? work?", "what's worth improving?", or "work out a plan for feature X" and get a worked-out
//? answer. Deeper RAG search + structured question/idea cards land in a following phase; this is
//? the free-form planning chat on top of the existing repo-aware `workspaces/aiChat` backend.

import { useEffect, useRef, useState } from 'react';

import { apiRequest, tryCatch, useTranslator } from '@luckystack/core/client';

import Icon from '../_components/Icon';
import { WsButton } from '../_components/primitives';
import { useWorkspaces } from '../_shell/WorkspacesContext';

export const template = 'workspaces';

interface Msg { id: string; role: 'user' | 'ai'; text: string; pending?: boolean }
let seq = 0;

//? Starter prompts — clickable so a first-time visitor instantly sees what this page is for.
const STARTERS: { icon: string; key: string }[] = [
  { icon: 'magnifying-glass', key: 'explain' },
  { icon: 'lightbulb', key: 'improve' },
  { icon: 'diagram-project', key: 'plan' },
  { icon: 'shield-halved', key: 'risks' },
];

export default function Interviewer() {
  const translate = useTranslator();
  const { activeWorkspace } = useWorkspaces();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [messages]);

  const ask = (text: string) => {
    const trimmed = text.trim();
    const workspaceId = activeWorkspace.id;
    if (!trimmed || !workspaceId || busy) return;
    const stamp = String(seq + 1); seq += 1;
    const aiId = `a${stamp}`;
    setMessages((prev) => [...prev, { id: `u${stamp}`, role: 'user', text: trimmed }, { id: aiId, role: 'ai', text: '', pending: true }]);
    setDraft('');
    setBusy(true);
    void (async () => {
      const [error, res] = await tryCatch(() => apiRequest({ name: 'workspaces/aiChat', version: 'v1', data: { workspaceId, message: trimmed } }));
      setMessages((prev) => prev.map((m) => {
        if (m.id !== aiId) return m;
        if (error || res?.status !== 'success' || res.result.error) return { ...m, pending: false, text: translate({ key: 'workspaces.interviewer.error' }) };
        return { ...m, pending: false, text: res.result.reply };
      }));
      setBusy(false);
    })();
  };

  const empty = messages.length === 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* intro header — always visible so the page's purpose is obvious */}
      <div className="px-5 md:px-6 pt-5 pb-3 border-b border-divider shrink-0">
        <div className="flex items-center gap-2 text-title">
          <span className="w-8 h-8 rounded-xl bg-primary/12 text-primary flex items-center justify-center"><Icon name="comments" /></span>
          <span className="text-xl font-semibold">{translate({ key: 'workspaces.interviewer.title' })}</span>
        </div>
        <p className="text-sm text-muted mt-1.5 max-w-2xl">{translate({ key: 'workspaces.interviewer.intro' })}</p>
      </div>

      {/* conversation */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 md:px-6 py-5">
        {empty ? (
          <div className="max-w-2xl mx-auto flex flex-col gap-4 pt-6">
            <div className="text-sm font-medium text-common">{translate({ key: 'workspaces.interviewer.startersTitle' })}</div>
            <div className="grid sm:grid-cols-2 gap-3">
              {STARTERS.map((s) => (
                <button key={s.key} type="button" onClick={() => { ask(translate({ key: `workspaces.interviewer.starter.${s.key}` })); }}
                  className="flex items-start gap-3 rounded-2xl border border-container1-border bg-container1 p-4 text-left hover:border-primary hover:bg-container1-hover transition-colors cursor-pointer">
                  <span className="w-8 h-8 shrink-0 rounded-lg bg-primary/12 text-primary flex items-center justify-center"><Icon name={s.icon} /></span>
                  <span className="text-sm text-common">{translate({ key: `workspaces.interviewer.starter.${s.key}` })}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto flex flex-col gap-4">
            {messages.map((m) => <Bubble key={m.id} m={m} />)}
          </div>
        )}
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-divider p-3 md:px-6">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <textarea
            value={draft} onChange={(e) => { setDraft(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(draft); } }}
            rows={1} placeholder={translate({ key: 'workspaces.interviewer.placeholder' })}
            className="flex-1 min-w-0 resize-none max-h-40 px-3.5 py-2.5 rounded-2xl border border-container1-border bg-container2/50 text-sm text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          <WsButton icon="paper-plane" onClick={() => { ask(draft); }} disabled={busy || draft.trim().length === 0}>{translate({ key: 'workspaces.interviewer.send' })}</WsButton>
        </div>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const mine = m.role === 'user';
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      {!mine && <span className="w-7 h-7 shrink-0 mr-2 rounded-lg bg-primary/12 text-primary flex items-center justify-center self-end"><Icon name="robot" /></span>}
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${mine ? 'bg-primary text-title-primary' : 'bg-container1 border border-container1-border text-common'}`}>
        {m.pending
          ? <span className="inline-flex gap-1 py-1">{[0, 1, 2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-current opacity-40 motion-safe:animate-pulse" style={{ animationDelay: `${String(i * 150)}ms` }} />)}</span>
          : m.text}
      </div>
    </div>
  );
}
