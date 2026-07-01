import redis from "./redis";

export interface GameDataProps {
  players: { 
    id: string, 
    name: string, 
    avatar: string,
    role: 'farmer' | 'queen' | 'manipulator' | null,
    selected?: boolean
  }[],
  gameCode: string,
  queenRoles: number,
  manipulatorRoles: number,
  currentCountdownId: number,
  state: 'lobby' | 'loadingScreen' | 'started' | 'finished',
  loadingScreenState: 'roulette' | 'focusFarmer' | 'focusPersonalCard' | null;
  selectedRewards: { [key: string]: string[] },
  availableRewards: {
    name: string,
    id: string
  }[],
  lives: number,
  maxLives: number,
  gameStartTime: number | null,
  totalDrinkTime: number,
  won: 'farmer' | 'player' | 'none' | false,
  revealed: { 
    id: string, 
    role: 'queen' | 'manipulator'
  }[],
}


const saveGameData = async (gameCode: string, data: GameDataProps) => {
  // console.log(gameCode)
  // console.log(data)
  await redis.set(`${process.env.PROJECT_NAME}-games:${gameCode}`, JSON.stringify(data));
  await redis.expire(`${process.env.PROJECT_NAME}-games:${gameCode}`, 60 * 60 * 24 * 7); // same TTL as session or adjust
  return true;
};

const getGameData = async (gameCode: string) => {
  const data = await redis.get(`${process.env.PROJECT_NAME}-games:${gameCode}`);
  return data ? JSON.parse(data) as GameDataProps : null;
};

const getAllGameDatas = async () => {
  const allGameDatas = await redis.keys("*");
  const GameDatas = await Promise.all(allGameDatas.map((gameData) => redis.get(gameData)));
  return GameDatas.map((gameData) => JSON.parse(gameData || "{}")); 
}


const deleteGameData = async (gameCode: string) => {
  await redis.del(`${process.env.PROJECT_NAME}-games:${gameCode}`);
  return true;
};

const gameExists = async (gameCode: string): Promise<boolean> => {
  const exists = await redis.exists(`${process.env.PROJECT_NAME}-games:${gameCode}`);
  return exists === 1;
};

export { saveGameData, getGameData, getAllGameDatas, deleteGameData, gameExists  };