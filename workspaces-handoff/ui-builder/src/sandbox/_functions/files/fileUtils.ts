import { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import {
  faFile,
  faFileCode,
  faFileImage,
  faFilePdf,
  faFileZipper,
  faFileLines,
  faFileVideo,
  faFileAudio,
} from "@fortawesome/free-solid-svg-icons";

export function getFileExtension(fileName: string): string {
  if (!fileName) return '';
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export function getMimeTypeCategory(mimeType: string): 'text' | 'image' | 'pdf' | 'video' | 'audio' | 'binary' {
  if (mimeType.startsWith('text/')) return 'text';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';

  if (mimeType.includes('javascript') || mimeType.includes('json') || mimeType.includes('xml')) {
    return 'text';
  }

  return 'binary';
}

export function getMonacoLanguage(extension: string): string {
  const languageMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    xml: 'xml',
    md: 'markdown',
    lua: 'lua',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    php: 'php',
    sh: 'shell',
    bat: 'bat',
    ps1: 'powershell',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    ini: 'ini',
    sql: 'sql',
    txt: 'plaintext',
  };

  return languageMap[extension.toLowerCase()] || 'plaintext';
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      // Remove the data:*/*;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function validateFileSize(file: File, maxSizeBytes: number): boolean {
  return file.size <= maxSizeBytes;
}

export function getFileIcon(extension: string, mimeType: string): IconDefinition {
  const ext = extension.toLowerCase();

  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'json', 'xml', 'html', 'css', 'scss', 'less', 'lua', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'cs', 'php', 'sh', 'bat'];
  if (codeExtensions.includes(ext)) {
    return faFileCode;
  }

  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  if (imageExtensions.includes(ext) || mimeType.startsWith('image/')) {
    return faFileImage;
  }

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    return faFilePdf;
  }

  const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2'];
  if (archiveExtensions.includes(ext)) {
    return faFileZipper;
  }

  const videoExtensions = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm'];
  if (videoExtensions.includes(ext) || mimeType.startsWith('video/')) {
    return faFileVideo;
  }

  const audioExtensions = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
  if (audioExtensions.includes(ext) || mimeType.startsWith('audio/')) {
    return faFileAudio;
  }

  const textExtensions = ['txt', 'md', 'log'];
  if (textExtensions.includes(ext)) {
    return faFileLines;
  }

  return faFile;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  //? some beatiful AI slop
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}
