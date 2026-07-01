import { ReactNode, useState } from 'react';
import { menuHandler } from 'src/_functions/menuHandler';

export interface InputDialogResult {
  name: string;
  description?: string;
}

interface InputDialogProps {
  title: string;
  content?: string | ReactNode;
  nameLabel?: string;
  namePlaceholder?: string;
  descriptionLabel?: string;
  descriptionPlaceholder?: string;
  showDescription?: boolean;
  nameValidation?: (value: string) => string | null; // Returns error message or null if valid
  resolve: (val: InputDialogResult | null) => void;
}

export const InputDialog = ({
  title,
  content,
  nameLabel = 'Name',
  namePlaceholder = 'Enter name...',
  descriptionLabel = 'Description',
  descriptionPlaceholder = 'Enter description (optional)...',
  showDescription = false,
  nameValidation,
  resolve
}: InputDialogProps) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = () => {
    // Run validation
    if (nameValidation) {
      const validationError = nameValidation(name);
      if (validationError) {
        setError(validationError);
        return;
      }
    }

    // Basic required check
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    resolve({ name: name.trim(), description: description.trim() || undefined });
    menuHandler.close();
  };

  const handleCancel = () => {
    resolve(null);
    menuHandler.close();
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
    // Clear error when user starts typing
    if (error) setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  const isValid = name.trim().length > 0 && !error;

  return (
    <div className="p-6 flex flex-col gap-4 bg-background2 text-text w-full max-w-md">
      <h2 className="text-xl font-bold">{title}</h2>

      {typeof content === 'string' ? (
        <p className="text-text2">{content}</p>
      ) : (
        content
      )}

      {/* Name Input */}
      <div className="flex flex-col gap-1">
        <label className="text-sm text-text2 font-medium">
          {nameLabel}
        </label>
        <input
          type="text"
          className={`border rounded px-3 py-2 bg-background text-text outline-none focus:ring-0 transition-colors ${error ? 'border-wrong' : 'border-border focus:border-primary'
            }`}
          value={name}
          onChange={handleNameChange}
          onKeyDown={handleKeyDown}
          placeholder={namePlaceholder}
          autoFocus
        />
        {error && (
          <span className="text-sm text-wrong">{error}</span>
        )}
      </div>

      {/* Description Input (optional) */}
      {showDescription && (
        <div className="flex flex-col gap-1">
          <label className="text-sm text-text2 font-medium">
            {descriptionLabel}
          </label>
          <textarea
            className="border border-border rounded px-3 py-2 bg-background text-text focus:border-primary outline-none focus:ring-0 resize-none transition-colors"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                handleCancel();
              }
            }}
            placeholder={descriptionPlaceholder}
            rows={3}
          />
        </div>
      )}

      <div className="flex gap-4 justify-end mt-2">
        <button
          onClick={handleCancel}
          className="px-4 py-2 rounded bg-background hover:bg-background-hover text-text text-sm font-semibold transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!isValid}
          className={`px-4 py-2 rounded text-sm text-white transition-colors font-semibold
            ${!isValid
              ? 'bg-primary/40 cursor-not-allowed'
              : 'bg-primary hover:bg-primary/80 cursor-pointer'
            }`}
        >
          Create
        </button>
      </div>
    </div>
  );
};

// Helper function to open input dialog
export const inputDialog = (props: Omit<InputDialogProps, 'resolve'>): Promise<InputDialogResult | null> => {
  return new Promise((resolve) => {
    menuHandler.open(
      <InputDialog {...props} resolve={resolve} />,
      { dimBackground: true, background: 'bg-background2', size: 'sm' }
    );
  });
};
