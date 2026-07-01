import { ReactNode, useState } from 'react';

import { useTranslator } from '@luckystack/core/client';

export interface ConfirmMenuProps {
  title: string;
  content?: string | ReactNode;
  /** When set, the user must type this exact string before the confirm button enables. */
  input?: string;
  /** Called with `true` (confirm) or `false` (cancel). The caller is responsible for closing the menu. */
  resolve: (confirmed: boolean) => void;
}

export function ConfirmMenu({ title, content, input, resolve }: ConfirmMenuProps) {
  const translate = useTranslator();
  const [inputValue, setInputValue] = useState('');

  const inputRequiredAndInvalid = input ? input !== inputValue : false;

  return (
    <form
      className="p-6 flex flex-col gap-4 bg-container1 w-full max-w-md"
      data-menuhandler-submit-on-enter="true"
      onSubmit={(event) => {
        event.preventDefault();
        if (inputRequiredAndInvalid) return;
        resolve(true);
      }}
    >
      <h2 className="text-xl font-bold text-title">{title}</h2>

      {typeof content === 'string' ? (
        <p className="text-sm text-common">{content}</p>
      ) : content}

      {input && (
        <div className="flex flex-col gap-1">
          <label className="text-sm text-common/80">
            {translate({ key: 'confirm.type' })}{' '}
            <span className="font-mono bg-container2 border border-container2-border px-1 rounded">{input}</span>{' '}
            {translate({ key: 'confirm.toConfirm' })}
          </label>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); }}
            className="h-9 px-3 rounded-md border border-container1-border bg-container1 text-title text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 transition-colors"
          />
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => { resolve(false); }}
          className="h-9 px-4 rounded-md bg-container2 hover:bg-container2-hover text-common hover:text-title text-sm font-semibold border border-container2-border transition-colors cursor-pointer"
        >
          {translate({ key: 'confirm.cancel' })}
        </button>
        <button
          type="submit"
          disabled={inputRequiredAndInvalid}
          className={`h-9 px-4 rounded-md text-title-primary text-sm font-semibold transition-colors
            ${inputRequiredAndInvalid
              ? 'bg-primary/50 cursor-not-allowed'
              : 'bg-primary hover:bg-primary-hover cursor-pointer'
            }`}
        >
          {translate({ key: 'confirm.confirm' })}
        </button>
      </div>
    </form>
  );
}
