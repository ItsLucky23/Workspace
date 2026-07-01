import { motion, AnimatePresence } from "framer-motion";
import { useRef } from "react";
import { CreateComponentMenuVisibleState } from "src/sandbox/types/createComponentMenuTypes";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFileMedical, faNoteSticky, faUpload } from "@fortawesome/free-solid-svg-icons";
import { useMenus } from "src/sandbox/_providers/MenusContextProvider";
import { useBlueprints, GridChange } from "src/sandbox/_providers/BlueprintsContextProvider";
import { useGrid } from "src/sandbox/_providers/GridContextProvider";
import { getFileExtension, getMimeTypeCategory, getMonacoLanguage, readFileAsBase64, readFileAsText, validateFileSize } from "src/sandbox/_functions/files/fileUtils";
import { inputDialog } from "src/_components/InputDialog";

export default function CreateComponentMenu() {

  const {
    createComponentMenuOpen,
    createComponentMenuPosition,
    setCreateComponentMenuOpen
  } = useMenus();

  const { applyChange } = useBlueprints();
  const { zoom, offset } = useGrid();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  // Get world coordinates from menu position
  const getWorldPosition = () => {
    if (!createComponentMenuPosition) return { x: 0, y: 0 };
    return {
      x: (createComponentMenuPosition.x - offset.x) / zoom,
      y: (createComponentMenuPosition.y - offset.y) / zoom
    };
  };

  // Validation function for file names - must have an extension
  const validateFileName = (name: string): string | null => {
    if (!name.trim()) {
      return 'File name is required';
    }

    const extension = getFileExtension(name);
    if (!extension) {
      return 'File name must include an extension (e.g., .txt, .tsx, .js)';
    }

    return null;
  };

  // Handle creating a new file
  const handleCreateFile = async () => {
    // Close the context menu first
    setCreateComponentMenuOpen(CreateComponentMenuVisibleState.CLOSED);

    const result = await inputDialog({
      title: 'Create New File',
      content: 'Enter a file name with extension (e.g., component.tsx)',
      nameLabel: 'File Name',
      namePlaceholder: 'myfile.tsx',
      nameValidation: validateFileName
    });

    if (!result) return; // User cancelled

    const worldPos = getWorldPosition();

    const newFile = {
      id: `file-${Date.now()}`,
      position: worldPos,
      name: result.name,
      code: '', // Empty file
      size: 0,
    };

    const change: GridChange = {
      type: 'create',
      itemType: 'file',
      item: newFile
    };
    applyChange(change);
  };

  // Handle creating a new note
  const handleCreateNote = async () => {
    // Close the context menu first
    setCreateComponentMenuOpen(CreateComponentMenuVisibleState.CLOSED);

    const result = await inputDialog({
      title: 'Add Note',
      nameLabel: 'Title',
      namePlaceholder: 'My Note'
    });

    if (!result) return; // User cancelled

    const worldPos = getWorldPosition();

    // Create initial TipTap JSON content with empty paragraph
    const initialContent = {
      type: 'doc',
      content: [
        { type: 'paragraph' }
      ]
    };

    const newNote = {
      id: `note-${Date.now()}`,
      position: worldPos,
      title: result.name,
      content: JSON.stringify(initialContent),
      width: 300,
      height: 200,
    };

    const change: GridChange = {
      type: 'create',
      itemType: 'note',
      item: newNote
    };
    applyChange(change);
  };

  // Handle file upload from input
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !createComponentMenuPosition) return;

    const file = files[0];

    // Validate file size
    if (!validateFileSize(file, MAX_FILE_SIZE)) {
      alert(`File size exceeds 5MB limit. File size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      return;
    }

    try {
      const fileExtension = getFileExtension(file.name);
      const mimeCategory = getMimeTypeCategory(file.type);
      const monacoLanguage = getMonacoLanguage(fileExtension);

      // Check if the file extension is a known text/code type by checking if Monaco recognizes it
      // This handles cases where browsers don't provide proper MIME types for code files (.tsx, .ts, etc.)
      const isKnownTextExtension = monacoLanguage !== 'plaintext' || fileExtension === 'txt';

      let fileContent: string;

      // Read file based on type - prioritize extension check for code files
      if (isKnownTextExtension || mimeCategory === 'text') {
        fileContent = await readFileAsText(file);
      } else if (mimeCategory === 'image') {
        fileContent = await readFileAsBase64(file);
      } else {
        // Binary files (PDF, ZIP, etc.)
        fileContent = await readFileAsBase64(file);
      }

      const worldPos = getWorldPosition();

      // Create new file blueprint
      const newFile = {
        id: `file-${Date.now()}`,
        position: worldPos,
        name: file.name,
        code: fileContent,
        size: file.size,
      };

      // Add to blueprints with history
      const change: GridChange = {
        type: 'create',
        itemType: 'file',
        item: newFile
      };
      applyChange(change);

      // Close menu
      setCreateComponentMenuOpen(CreateComponentMenuVisibleState.CLOSED);

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error reading file:', error);
      alert('Failed to read file. Please try again.');
    }
  };

  if (!createComponentMenuPosition) { return null; }

  return (
    <AnimatePresence>
      {createComponentMenuOpen == CreateComponentMenuVisibleState.OPEN && (
        <motion.div
          initial={{ opacity: 0, scale: 0.90, y: -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.90, y: -5 }}
          transition={{ duration: 0.2 }}
          style={{
            position: "absolute",
            zIndex: 1000,
          }}
        >
          <div
            className="bg-background2 rounded gap-3 flex flex-col w-72 shadow-xl border border-border2 text-text"
            style={{
              position: "absolute",
              left: createComponentMenuPosition.x,
              top: createComponentMenuPosition.y,
              transform: 'translate(20px, calc(-100px + -50%))',
            }}
            id="createComponentMenu"
          >
            <div className="flex flex-col gap-2 p-3">
              <div className="text-xs font-bold text-text2 uppercase tracking-wider px-1">
                Create
              </div>
              <div
                className="p-2 hover:bg-background2-hover rounded cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <FontAwesomeIcon icon={faUpload} className="text-muted mr-2" />
                Upload File
              </div>
              <div
                className="p-2 hover:bg-background2-hover rounded cursor-pointer"
                onClick={handleCreateFile}
              >
                <FontAwesomeIcon icon={faFileMedical} className="text-muted mr-2" />
                Create New File
              </div>
              <div
                className="p-2 hover:bg-background2-hover rounded cursor-pointer"
                onClick={handleCreateNote}
              >
                <FontAwesomeIcon icon={faNoteSticky} className="text-muted mr-2" />
                Add Note
              </div>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}