//? The skills surface: a list you browse and a full editor you open — one editor, whether you are
//? changing a skill or writing a new one.
//?
//? What this replaces: a card per skill that expanded into a six-row textarea, with the skill's whole
//? text squeezed into it, and a SEPARATE "add" form beneath the list that took only a name and an
//? instruction — so a new skill could not be given examples or a scope without saving it and then
//? reopening it. Two forms for the same object, neither of which showed the whole thing.
//?
//? The on/off toggle is gone (owner decision 2026-08-20). A skill was switched on here AND scoped by
//? apply points, so it could be on and still do nothing because its scope excluded the run you were
//? looking at. Scope is now the only switch, and a pipeline stage picks the skills it wants by id —
//? which is where "should this stage use the humanizer?" is actually answerable.
//? @adr 0007

/* eslint-disable react-refresh/only-export-components -- the list and its editor are one feature; splitting them to satisfy a dev-only fast-refresh rule buys nothing. Not route components. */
import { useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

import { menuHandler } from 'src/_functions/menuHandler';

import Icon from '../_components/Icon';
import { EmptyPicker } from '../_components/SetupNotice';
import { FOCUS_RING, InfoTip, WsButton } from '../_components/primitives';
import { INPUT_CLS_FULL as fieldCls } from '../_components/settings';
import { useWorkspaces } from '../_shell/WorkspacesContext';
import { AI_SKILL_APPLY_POINTS } from '../_data/types';
import type { AiSkillEntry } from '../_data/types';

//? Monospace and tall: a skill IS its text, and reviewing one in a six-row proportional box is why
//? nobody could tell what a skill actually said.
const editorCls = 'w-full px-3 py-2 rounded-lg border border-container1-border bg-container2/50 text-sm font-mono leading-relaxed text-title focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 resize-y';

export function SkillsSection() {
  const translate = useTranslator();
  const { aiSkills } = useWorkspaces();
  //? `null` = the list. A string id = editing that skill. `''` = writing a new one — the same editor,
  //? because "add" and "edit" differ only in whether there is anything in the boxes.
  const [editing, setEditing] = useState<string | null>(null);

  if (editing !== null) {
    const skill = aiSkills.find((s) => s.id === editing);
    return <SkillEditor skill={skill} onDone={() => { setEditing(null); }} />;
  }

  return (
    <div className={`flex flex-col gap-3`}>
      <div>
        <div className={`text-base font-semibold text-title`}>{translate({ key: 'workspaces.skills.title' })}</div>
        <div className={`text-sm text-muted mt-0.5`}>{translate({ key: 'workspaces.skills.desc' })}</div>
      </div>

      {aiSkills.length === 0 && <EmptyPicker icon="wand-magic-sparkles" label={translate({ key: 'workspaces.skills.none' })} />}

      <div className={`flex flex-col gap-1.5`}>
        {aiSkills.map((s) => (
          <button
            key={s.id} type="button" onClick={() => { setEditing(s.id); }}
            className={`flex items-start gap-3 rounded-xl border border-container1-border bg-container1 px-3 py-2.5 text-left cursor-pointer hover:bg-container1-hover transition-colors ${FOCUS_RING}`}
          >
            <Icon name="wand-magic-sparkles" className={`mt-0.5 text-muted shrink-0`} />
            <span className={`min-w-0 flex-1`}>
              <span className={`flex items-center gap-2`}>
                <span className={`text-sm font-semibold text-title truncate`}>{s.name}</span>
                {s.builtin && <span className={`text-[10px] uppercase tracking-wide rounded-full bg-container2 text-muted px-1.5 py-0.5 shrink-0`}>{translate({ key: 'workspaces.skills.builtin' })}</span>}
              </span>
              {/* Where it runs, said plainly — this is the only switch a skill has now. */}
              <span className={`block text-xs text-meta mt-0.5`}>{scopeLine(s, translate)}</span>
              <span className={`block text-xs text-muted mt-0.5 line-clamp-2`}>{s.instruction.split('\n')[0]}</span>
            </span>
            <Icon name="angle-right" className={`mt-1 text-muted text-xs shrink-0`} />
          </button>
        ))}
      </div>

      <div>
        <WsButton icon="plus" onClick={() => { setEditing(''); }}>{translate({ key: 'workspaces.skills.add' })}</WsButton>
      </div>
    </div>
  );
}

/** The one-line answer to "does this skill do anything, and where". */
function scopeLine(s: AiSkillEntry, translate: ReturnType<typeof useTranslator>): string {
  if (s.applyPoints.includes('all')) return translate({ key: 'workspaces.skills.scopeAll' });
  if (s.applyPoints.length > 0) {
    const names = s.applyPoints.map((p) => translate({ key: `workspaces.workspaceSettings.skillsAi.point.${p}` }));
    return translate({ key: 'workspaces.skills.scopeSome', params: [{ key: 'points', value: names.join(', ') }] });
  }
  //? Not "off": it still runs wherever a pipeline stage picked it. Saying "off" here would be the
  //? same lie the old toggle told.
  return translate({ key: 'workspaces.skills.scopeStagesOnly' });
}

function SkillEditor({ skill, onDone }: { skill: AiSkillEntry | undefined; onDone: () => void }) {
  const translate = useTranslator();
  const { saveAiSkill, deleteAiSkill, resetAiSkill } = useWorkspaces();
  const [name, setName] = useState(skill?.name ?? '');
  const [instruction, setInstruction] = useState(skill?.instruction ?? '');
  const [examples, setExamples] = useState(skill?.examples ?? '');
  const [points, setPoints] = useState<string[]>(skill?.applyPoints ?? []);
  const [error, setError] = useState('');

  const togglePoint = (p: string): void => {
    //? 'all' is exclusive: "everywhere" plus a list of somewheres is a contradiction the resolver
    //? would silently settle by ignoring the list.
    setPoints((prev) => (prev.includes(p)
      ? prev.filter((x) => x !== p)
      : (p === 'all' ? ['all'] : [...prev.filter((x) => x !== 'all'), p])));
  };

  const save = (): void => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) { setError(translate({ key: 'workspaces.skills.errName' })); return; }
    if (instruction.trim().length === 0) { setError(translate({ key: 'workspaces.skills.errInstruction' })); return; }
    saveAiSkill({ ...(skill ? { skillId: skill.id } : {}), name: trimmedName, instruction, examples, applyPoints: points });
    onDone();
  };

  const remove = (): void => {
    if (!skill) return;
    void menuHandler.confirm({
      title: translate({ key: 'workspaces.skills.deleteTitle', params: [{ key: 'name', value: skill.name }] }),
      content: translate({ key: 'workspaces.skills.deleteBody' }),
    }).then((ok) => {
      if (!ok) return;
      deleteAiSkill(skill.id);
      onDone();
    });
  };

  return (
    <div className={`flex flex-col gap-3`}>
      <div className={`flex items-center gap-2`}>
        <button type="button" onClick={onDone} className={`inline-flex items-center gap-1.5 text-sm text-muted hover:text-title cursor-pointer rounded-lg ${FOCUS_RING}`}>
          <Icon name="angle-left" className={`text-xs`} /> {translate({ key: 'workspaces.skills.back' })}
        </button>
        {skill?.builtin === true && <span className={`text-[10px] uppercase tracking-wide rounded-full bg-container2 text-muted px-1.5 py-0.5`}>{translate({ key: 'workspaces.skills.builtin' })}</span>}
      </div>

      <div>
        <label htmlFor="ws-skill-name" className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.skills.name' })}</label>
        <input id="ws-skill-name" value={name} onChange={(e) => { setName(e.target.value); setError(''); }} placeholder={translate({ key: 'workspaces.skills.namePlaceholder' })} className={`${fieldCls} mt-1.5`} />
      </div>

      <div>
        <label htmlFor="ws-skill-instruction" className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.skills.instruction' })}</label>
        <div className={`text-xs text-muted mt-0.5 mb-1.5`}>{translate({ key: 'workspaces.skills.instructionHelp' })}</div>
        {/* The whole text, in one place, tall enough to read. A skill IS this text. */}
        <textarea id="ws-skill-instruction" value={instruction} onChange={(e) => { setInstruction(e.target.value); setError(''); }} rows={18} placeholder={translate({ key: 'workspaces.skills.instructionPlaceholder' })} className={editorCls} />
      </div>

      <div>
        <label htmlFor="ws-skill-examples" className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.skills.examples' })}</label>
        <div className={`text-xs text-muted mt-0.5 mb-1.5`}>{translate({ key: 'workspaces.skills.examplesHelp' })}</div>
        <textarea id="ws-skill-examples" value={examples} onChange={(e) => { setExamples(e.target.value); }} rows={6} placeholder={translate({ key: 'workspaces.skills.examplesPlaceholder' })} className={editorCls} />
      </div>

      <div>
        <div className={`flex items-center gap-1.5`}>
          <span className={`text-sm font-semibold text-title`}>{translate({ key: 'workspaces.skills.scope' })}</span>
          <InfoTip
            align="start"
            title={translate({ key: 'workspaces.skills.scopeTipTitle' })}
            body={translate({ key: 'workspaces.skills.scopeTipBody' })}
            points={[
              { id: 'stages', label: translate({ key: 'workspaces.skills.scopeTipStagesLabel' }), desc: translate({ key: 'workspaces.skills.scopeTipStagesDesc' }) },
              { id: 'all', label: translate({ key: 'workspaces.skills.scopeTipAllLabel' }), desc: translate({ key: 'workspaces.skills.scopeTipAllDesc' }) },
            ]}
          />
        </div>
        <div className={`text-xs text-muted mt-0.5 mb-1.5`}>{translate({ key: 'workspaces.skills.scopeHelp' })}</div>
        <div className={`flex flex-wrap gap-1.5`}>
          {AI_SKILL_APPLY_POINTS.map((p) => (
            <button
              key={p} type="button" role="switch" aria-checked={points.includes(p)}
              onClick={() => { togglePoint(p); }}
              className={`text-xs rounded-full px-2.5 py-1 border cursor-pointer transition-colors ${FOCUS_RING} ${points.includes(p) ? 'bg-primary/15 border-primary text-title' : 'bg-container2/50 border-container1-border text-muted hover:text-common'}`}
            >
              {translate({ key: `workspaces.workspaceSettings.skillsAi.point.${p}` })}
            </button>
          ))}
        </div>
      </div>

      <div className={`flex items-center gap-3 flex-wrap`}>
        <WsButton icon="check" onClick={save}>{translate({ key: 'workspaces.skills.save' })}</WsButton>
        {skill?.builtin === true && (
          <WsButton variant="ghost" icon="arrows-rotate" onClick={() => { resetAiSkill(skill.id); onDone(); }}>{translate({ key: 'workspaces.skills.reset' })}</WsButton>
        )}
        {/* A builtin cannot be deleted — it is reset instead, which is why the two never both show. */}
        {skill !== undefined && !skill.builtin && (
          <WsButton variant="ghost" icon="trash" onClick={remove}>{translate({ key: 'workspaces.skills.delete' })}</WsButton>
        )}
        {error.length > 0 && <span className={`text-xs text-wrong`}>{error}</span>}
      </div>
    </div>
  );
}
