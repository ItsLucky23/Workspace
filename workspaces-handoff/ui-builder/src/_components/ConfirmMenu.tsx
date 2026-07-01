import { ReactNode, useState } from 'react';
import { menuHandler } from 'src/_functions/menuHandler';

interface ConfirmMenuProps {
  title: string;
  content?: string | ReactNode;
  input?: string;
  resolve: (val: boolean) => void;
}

export const ConfirmMenu = ({ title, content, input, resolve }: ConfirmMenuProps) => {
  const [inputValue, setInputValue] = useState('');

  const handleConfirm = () => {
    if (input && input !== inputValue) return;
    resolve(true);
    menuHandler.close();
  };

  const handleCancel = () => {
    resolve(false);
    menuHandler.close();
  };

  const inputRequiredAndInvalid = input && input !== inputValue ? true : false;

  return (
    <div className="p-6 flex flex-col gap-4 bg-background2 text-text w-full max-w-md">
      <h2 className="text-xl font-bold">{title}</h2>

      {typeof content === 'string' ? (
        <p className="text-text2">{content}</p>
      ) : (
        content
      )}

      {input && (
        <div className="flex flex-col gap-1">
          <label className="text-sm text-text2">
            Type <span className="font-mono bg-background px-1 rounded">{input}</span> to confirm:
          </label>
          <input
            type="text"
            className="border border-border rounded px-3 py-2 bg-background text-text outline-none focus:ring-0 focus:border-primary transition-colors"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
          />
        </div>
      )}

      <div className="flex gap-4 justify-end">
        <button
          onClick={handleCancel}
          className="px-4 py-2 rounded bg-background hover:bg-background-hover text-text text-sm font-semibold transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={inputRequiredAndInvalid}
          className={`px-4 py-2 rounded text-sm text-white transition-colors font-semibold
            ${inputRequiredAndInvalid
              ? 'bg-primary/40 cursor-not-allowed'
              : 'bg-primary hover:bg-primary/80 cursor-pointer'
            }`}
        >
          Confirm
        </button>
      </div>
    </div>
  );
};

export const confirmDialog = (props: Omit<ConfirmMenuProps, 'resolve'>): Promise<boolean> => {
  return new Promise((resolve) => {
    menuHandler.open(
      <ConfirmMenu {...props} resolve={resolve} />,
      { dimBackground: true, background: 'bg-background2', size: 'sm' }
    );
  });
};
