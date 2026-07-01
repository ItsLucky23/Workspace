import { useGrid } from "../../_providers/GridContextProvider";
import { useBlueprints, GridChange } from "../../_providers/BlueprintsContextProvider";
import { useDrawing } from "../../_providers/DrawingContextProvider";
import { getFileExtension, getMimeTypeCategory, getMonacoLanguage, readFileAsBase64, readFileAsText, validateFileSize } from "../files/fileUtils";
import { file } from "../../types/blueprints";

export default function useOnFileDrop() {
  const { zoom, offset } = useGrid();
  const { applyChange } = useBlueprints();
  const { drawingEnabled } = useDrawing();

  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

  const handleDragOver = (e: DragEvent) => {
    // Don't allow drag-and-drop when drawing is enabled
    if (drawingEnabled) { return; }

    // Check if dragging files
    if (e.dataTransfer?.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDrop = async (e: DragEvent) => {
    // Don't allow drag-and-drop when drawing is enabled
    if (drawingEnabled) {
      console.log('[DROP EVENT] Blocked - drawing is enabled');
      return;
    }

    e.preventDefault();

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    // Process each file
    for (let i = 0; i < files.length; i++) {
      const droppedFile = files[i];

      // Validate file size
      if (!validateFileSize(droppedFile, MAX_FILE_SIZE)) {
        alert(`File "${droppedFile.name}" exceeds 5MB limit. File size: ${(droppedFile.size / 1024 / 1024).toFixed(2)}MB`);
        continue;
      }

      try {
        const mimeCategory = getMimeTypeCategory(droppedFile.type);
        const extension = getFileExtension(droppedFile.name);
        const monacoLanguage = getMonacoLanguage(extension);

        // Check if the file extension is a known text/code type by checking if Monaco recognizes it
        // This handles cases where browsers don't provide proper MIME types for code files (.tsx, .ts, etc.)
        const isKnownTextExtension = monacoLanguage !== 'plaintext' || extension === 'txt';

        let fileContent: string = '';

        // Read file based on type - prioritize extension check for code files
        if (isKnownTextExtension || mimeCategory === 'text') {
          fileContent = await readFileAsText(droppedFile);
        } else if (mimeCategory === 'image') {
          fileContent = await readFileAsBase64(droppedFile);
        } else {
          // Binary files (PDF, ZIP, etc.)
          fileContent = await readFileAsBase64(droppedFile);
        }

        // Convert screen coordinates to world coordinates
        const worldX = (e.clientX - offset.x) / zoom;
        const worldY = (e.clientY - 50 - offset.y) / zoom;

        // Create new file blueprint (offset each file slightly)
        const newFile: file = {
          id: `file-${Date.now()}-${i}`,
          position: { x: worldX + (i * 20), y: worldY + (i * 20) },
          name: droppedFile.name,
          code: fileContent,
          size: droppedFile.size,
        };

        // Apply change for this file
        const change: GridChange = {
          type: 'create',
          itemType: 'file',
          item: newFile
        };
        applyChange(change);
      } catch (error) {
        console.error('Error reading file:', error);
        alert(`Failed to read file "${droppedFile.name}". Please try again.`);
      }
    }
  };

  return { handleDragOver, handleDrop };
}

