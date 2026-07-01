import type { SessionLayout } from "config";
import redis from "./redis";
// import { logout } from "../sockets/utils/logout";

const saveSession = async (token: string, data: SessionLayout, newUser?: boolean) => {
  await redis.set(`${process.env.PROJECT_NAME}-session:${token}`, JSON.stringify(data));
  await redis.expire(`${process.env.PROJECT_NAME}-session:${token}`, 60 * 60 * 24 * 7); //? 7 days

  const { ioInstance } = await import('../sockets/socket');

  const io = ioInstance;
  if (!io) { return false; } //? if this fails we are fucked but it should never fail

  if (newUser) { //? new user is true when someone logs in
    const userId = data?.id;
    if (!userId) return;

    const tokensOfPreviousUsersKey = `${process.env.PROJECT_NAME}-activeUsers:${userId}`
    const tokensOfPreviousUsers = await redis.smembers(tokensOfPreviousUsersKey);

    const { logout } = await import('../sockets/utils/logout');

    await Promise.all(tokensOfPreviousUsers.map(async (tokenOfPreviousUser) => {
      const sockets = io.sockets.adapter.rooms.get(tokenOfPreviousUser); // Set of socket IDs
      if (sockets) { //? if we found a client it means the user is still connected
        console.log('remving old session data from sockets', 'green')
        for (const socketId of sockets) {
          const socket = io.sockets.sockets.get(socketId);
          if (socket) {
            await logout({ token: tokenOfPreviousUser, socket, userId });
          }
        }
      } else {
        //? if we didnt find any clients it means the user is not connected, we can just delete there session data
        await redis.del(`${process.env.PROJECT_NAME}-session:${tokenOfPreviousUser}`);
        await redis.srem(tokensOfPreviousUsersKey, tokenOfPreviousUser);
      }
    }));

    await redis.sadd(tokensOfPreviousUsersKey, token);
    await redis.expire(tokensOfPreviousUsersKey, 60 * 60 * 24 * 7); //? 7 days
  }

  if (io.sockets.adapter.rooms.has(token)) {
    io.to(token).emit('updateSession', JSON.stringify(data));
  }
};

const getSession = async (token: string | null) => {
  if (!token) return {};
  const session = await redis.get(`${process.env.PROJECT_NAME}-session:${token}`);
  if (!session) { return {} };
  const formattedSession = JSON.parse(session);
  if (!formattedSession) { return {} };
  return {...formattedSession, token: token};
};

const deleteSession = async (token: string) => {
  const user = await redis.get(`${process.env.PROJECT_NAME}-session:${token}`);

  if (user) {
    const userId = JSON.parse(user)?.id;
    if (userId) {
      const tokensOfPreviousUsers = `${process.env.PROJECT_NAME}-activeUsers:${userId}`;
      const { ioInstance } = await import('../sockets/socket');
      // ioInstance?.to(token).emit('forceLogout');
      if (ioInstance?.sockets.adapter.rooms.has(token)) {
        ioInstance.to(token).emit('forceLogout');
      }

      await redis.srem(tokensOfPreviousUsers, token);
    }
  }

  await redis.del(`${process.env.PROJECT_NAME}-session:${token}`);
  return true;
};

const getAllSessions = async () => {
  const sessions = await redis.keys(`${process.env.PROJECT_NAME}-session:*`);
  const sessionData = await Promise.all(sessions.map((session) => redis.get(session)));
  return sessionData.map((session) => JSON.parse(session || "{}")); 
}

// const clearAllSessions = async () => {
//   const sessions = await redis.keys("*");
//   await Promise.all(sessions.map((session) => redis.del(session)));
//   return true; 
// }

export { saveSession, getSession, deleteSession, getAllSessions };
