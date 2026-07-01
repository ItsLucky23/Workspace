import { PrismaClient } from '@prisma/client';
import { AuthProps, SessionLayout } from 'config';
import path from 'path';
import { GameDataProps } from 'server/functions/game';
import sharp from "sharp";

interface Functions {
  prisma: PrismaClient;

  saveSession: (sessionId: string, data: any) => Promise<boolean>;
  getSession: (sessionId: string) => Promise<any | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;

  saveGameData: (gameCode: string, data: GameDataProps) => Promise<boolean>;
  getGameData: (gameCode: string) => Promise<GameDataProps | null>;
  deleteGameData: (gameCode: string) => Promise<boolean>;
  gameExists: (gameCode: string) => Promise<boolean>;

  tryCatch: <T, P>(func: (values: P) => Promise<T> | T, params?: P) => Promise<[any, T | null]>;

  [key: string]: any; // allows for other functions that are not defined as a type but do exist in the functions folder
};

interface ApiParams {
  data: Record<string, any>;
  functions: Functions;
  user: SessionLayout;
};


const auth: AuthProps = {
  login: true, //? checks if the session data has an id. 
  additional: [
  ]
}

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);
const main = async ({ data, functions, user }: ApiParams) => {

  const { avatar, name, theme, language } = data;

  if (avatar) {
    console.log(avatar)
    const matches = avatar.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, "base64");

      // save as WebP under user's ID
      const fileName = `${user.id}.webp`;
      const filePath = path.join(process.cwd(), "uploads", fileName);

      try {
        await sharp(buffer)
          .webp({ quality: 80 }) // adjust quality if you want
          .toFile(filePath);

        console.log(`✅ Avatar saved for ${user.name} at ${filePath}`);
      } catch (err) {
        console.error("Error saving avatar:", err);
        return { status: "error" };
      }
    } else { console.log("failed to upload new avatar") }
  }

  let newData = {};

  if (avatar) newData = { ...newData, avatar: `${user.id}` }
  if (name) newData = { ...newData, name }
  if (theme) newData = { ...newData, theme }
  if (language) newData = { ...newData, language }

  //? here we can assume the avatar was uploaded successfully if avatar !=  null

  console.log(user)
  if (!user.token) return { status:'error' }

  await functions.prisma.user.update({
    where: { id: user.id },
    data: newData
  })

  await functions.saveSession(user.token, {...user, ...newData});

  return { status: 'success' }
}

export { auth, main }