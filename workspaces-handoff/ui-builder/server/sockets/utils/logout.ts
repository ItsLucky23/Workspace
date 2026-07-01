import { Socket } from "socket.io";
import redis from "../../functions/redis";
import { tryCatch } from "../../functions/tryCatch";
import { disconnectTimers, tempDisconnectedSockets } from "./activityBroadcaster";
import { deleteSession } from "../../functions/session";
import { socketLeaveRoom } from "./activityBroadcaster";

export const logout = async ({ token, socket, userId }: {
  token: string | null,
  socket: Socket | undefined,
  userId: string | null,
}) => {
  const [error, result] = await tryCatch(async () => {
    if (!socket) { 
      console.log('Trying to logout but invalid socket', 'red');
      return;
    }
    if (!token) { 
      console.log('Trying to logout without a token', 'red');
      return;
    }
    
    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    }

    if (disconnectTimers.has(token)) {
      const timer = disconnectTimers.get(token);
      if (timer) {
        clearTimeout(timer);
        disconnectTimers.delete(token);
      } 
    }

    console.log(`Logging out user with token: ${token}`, 'cyan');
    
    await socketLeaveRoom({ token, socket, newPath: null });
    await deleteSession(token);
    const tokensOfActiveUsers = `${process.env.PROJECT_NAME}-activeUsers:${userId}`
    await redis.srem(tokensOfActiveUsers, token);
    socket.leave(token);
    return true;
  });
  if (error) {
    if (socket) {
      socket.emit(`logout`, "error");
    }
  } else if (result) {
    if (socket) {
      socket.emit(`logout`, "success");
    }
  }
}