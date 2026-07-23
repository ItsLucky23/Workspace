import fs from 'node:fs';
import path from 'node:path';

const normalizePath = (value: string): string => value.split(path.sep).join('/');

const walkFunctionFiles = (directory: string, results: string[] = []): string[] => {
  if (!fs.existsSync(directory)) return results;

  for (const entry of fs.readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (fs.statSync(absolute).isDirectory()) {
      walkFunctionFiles(absolute, results);
    } else if (entry.endsWith('.ts')) {
      results.push(normalizePath(absolute));
    }
  }
  return results;
};

export const collectServerRequestFunctionFiles = (rootDirectory = process.cwd()): string[] => {
  const relativeFiles = (directory: string): string[] =>
    walkFunctionFiles(path.join(rootDirectory, directory)).map((filePath) => normalizePath(path.relative(rootDirectory, filePath)));
  const defaults = [
    ...relativeFiles('server/functions'),
    ...relativeFiles('shared'),
  ];
  const project = relativeFiles('functions');
  const byName = new Map<string, string>();
  for (const filePath of defaults) byName.set(path.basename(filePath, '.ts'), filePath);
  for (const filePath of project) byName.set(path.basename(filePath, '.ts'), filePath);
  return [...byName.values()].sort();
};
