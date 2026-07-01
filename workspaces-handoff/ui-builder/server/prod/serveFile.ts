import fs from "fs";
import { IncomingMessage, ServerResponse } from "http";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootFolder = path.join(__dirname, '../dist');

export const serveFavicon = (res: ServerResponse) => {
  //? here we get the favicon.ico file from the public folder and serve it to the client
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const faviconPath = path.join(__dirname, '../public', 'favicon.ico');
  res.writeHead(200, { 'Content-Type': 'image/x-icon' });
  fs.createReadStream(faviconPath).pipe(res); 
}

export const serveFile = async (req: IncomingMessage | { url: string }, res: ServerResponse) => {

  //? if request is / (root) we serve the index.html 
  const url = !req.url ? 'index.html' : req.url == '/' ? 'index.html' : req.url;
  const safePath = path.normalize(decodeURIComponent(url)).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(rootFolder, safePath);

  console.log(filePath)
  console.log(rootFolder)

  if (!filePath.startsWith(rootFolder)) {
    //! here we avoid directory traversal attacks
    res.writeHead(403, { "Content-Type": "text/plain" });
    return res.end("Forbidden");
  }

  //? here we check if the file extension or just the filename is in the list of files we dont want to serve
  //? a file that is in the list below should not be able to run this function in the first place cause we filter the routePath using zod before calling this function
  //? but if it passes somehow, we avoid it being served
  if (filePath.includes('.env') || 
      filePath.includes('.ts') || 
      filePath.includes('.tsx') || 
      filePath.includes('.py') || 
      filePath.includes('package.json') || 
      filePath.includes('package-lock.json') || 
      filePath.includes('.gitignore') || 
      filePath.includes('eslint.config.js') || 
      filePath.includes('postcss.config.mjs') || 
      filePath.includes('README.md') || 
      filePath.includes('redis.conf') || 
      filePath.includes('tailwind.config.js') || 
      filePath.includes('tsconfig.app.json') || 
      filePath.includes('tsconfig.json') || 
      filePath.includes('tsconfig.node.json') || 
      filePath.includes('vite.config.ts') || 
      filePath.includes('schema.prisma')
  ) {
    return res.end("Forbidden");
  }
  

  const extname = path.extname(filePath);
  let contentType = 'text/html';

  //? here we get the content type of the file and serve it to the client
  //? if the file extension is not in the list below, we serve the index.html file
  switch (extname) {
    case '.css': contentType = 'text/css'; break;
    case '.js': contentType = 'text/javascript'; break;
    case '.json': contentType = 'application/json'; break;
    case '.png': contentType = 'image/png'; break;
    case '.jpg':
    case '.jpeg': contentType = 'image/jpeg'; break;
    case '.gif': contentType = 'image/gif'; break;
    case '.svg': contentType = 'image/svg+xml'; break;
    case '.ico': contentType = 'image/x-icon'; break;
    default:
      contentType = 'text/html';
      filePath = path.join(rootFolder, 'index.html');
  }

  try {
    //? attempt to read the file and serve it to the client
    const content = await fs.promises.readFile(filePath);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (err) {
    if (url == 'index.html') {
      res.end("-_- you have to run the 'npm run build' command first -_-")
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  }
};