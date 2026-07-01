// ------------
// Activity Broadcaster
// ------------
// This module provides info about the users activty
// this is usefull to make a game to pause it for example when the user is not active

import { Server, Socket } from "socket.io";
import { deleteSession, getSession } from "../../functions/session";
import handleSyncRequest from "../handleSyncRequest";
import { ioInstance } from "../socket";

export const disconnectTimers = new Map<string, NodeJS.Timeout>();
export const disconnectReasonsWeIgnore: string[] = ['ping timeout', ];
export const disconnectReasonsWeAllow: string[] = ['transport close', 'transport error'];
export const tempDisconnectedSockets = new Set<string>();
export const clientSwitchedTab = new Set<string>();

export const socketConnected = async ({
  token,
  io
}: {
  token: string,
  io: Server
}) => {
  const timer = disconnectTimers.get(token);
  if (timer) { 
    console.log(`user came back with token: ${token}`, 'yellow');
    clearTimeout(timer);
    disconnectTimers.delete(token);
    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    } else {
      console.log(`a user connected with token: ${token}`, 'cyan');
    }
  }

  const session = await getSession(token);
  const userId = session?.id || null;
  const code = session?.code || null;

  if (!code) { return; }
  if (!userId) { return; }

  informRoomPeers({ token, io, event: 'userBack', extraData: { ignoreSelf: true } });
}


export const socketLeaveRoom = async ({ token, socket, newPath }: {
  token: string | null,
  socket: Socket,
  newPath: string | null
}) => {

  //? retrieve users session data
  if (!token) { 
    console.log('trying to update room peers but no token provided', 'red'); 
    return;
  }

  const user = await getSession(token);
  if (!user?.id) { 
    console.log(`no session data for given token: ${token}`, 'red'); 
    return;
  }

  const { pathName, searchParams } = user.location || {};



  /////////////
  //? EXAMPLE USAGE
  /////////////

  
  // console.log(`
  //   check1: ${pathName == '/games/test123'}
  //   check2: ${user.code}
  //   check3: ${!newPath || newPath !== pathName}
  // `, 'cyan');
  
  // //? if user is at a certain location we run a sync function to update the other players that are in the same room has him
  // if (
  //   pathName == '/games/test123' &&
  //   user.code &&
  //   (!newPath || newPath !== pathName)
  // ) {
  //   console.log('socket is leaving test123 game', 'cyan');
  //   handleSyncRequest({
  //     msg: { 
  //       name: 'sync/games/test123/playerLeave', 
  //       data: { gameCode: user.code, oldUser: user },
  //       cb: 'playerLeave',
  //       receiver: searchParams?.code, ignoreSelf: true
  //     },
  //     socket,
  //     token
  //   });
  //   socket.leave(user.code);
  // }

  return user;

}

const getDisconnectTime = ({ 
  token, 
  reason 
}: {
  token: string,
  reason: string | undefined
}) => {
  return clientSwitchedTab.has(token) 
    ? 20000 
    // ? 3000 
    : disconnectReasonsWeAllow.includes(reason ?? "NULL") 
    ? 60000 
    : 2000
}

export const socketDisconnecting = async ({
  token,
  reason,
  socket
}: {
  token: string,
  reason: string,
  socket: Socket
}) => {

  if (disconnectReasonsWeIgnore.includes(reason)) {
    console.log(`user disconnected but we ignore it, reason: ${reason}`, 'yellow');
    return; 
  }

  if (!token) { return; }
  if (!tempDisconnectedSockets.has(token)) {
    tempDisconnectedSockets.add(token);
  } else {
    return; //? if the user is already in the tempDisconnectedSockets array we ignore the disconnect event
  }

  const time = getDisconnectTime({ token, reason });

  let deleteSessionOnDisconnect = true;
  if (clientSwitchedTab.has(token)) {
    deleteSessionOnDisconnect = false;
    clientSwitchedTab.delete(token);
  }

  console.log(`user disconnected, reason: ${reason}, timer: ${time/1000} seconds`, 'yellow');

  const timeout = setTimeout(async () => {
    if (tempDisconnectedSockets.has(token)) {
      tempDisconnectedSockets.delete(token);
    } else { return; } //? if the user has reconnected we dont run the logout function

    if (disconnectTimers.get(token) !== timeout) { return };

    await socketLeaveRoom({ token, socket, newPath: null });

    //? we only delete the session if the user disconnected themself, it the server kicked them it means that they were kicked from a game
    if (deleteSessionOnDisconnect) {
      await deleteSession(token);
    }

    console.log(`user fully disconnected, reason: ${reason}, timer : ${time/1000} seconds, deleteSessionOnDisconnect: ${deleteSessionOnDisconnect}`, 'yellow');
  }, time);

  if (disconnectTimers.has(token)) {
    clearTimeout(disconnectTimers.get(token)!);
    disconnectTimers.delete(token);
  }
  disconnectTimers.set(token, timeout);

}

const informRoomPeers = async ({
  token,
  io = ioInstance,

  event,
  extraData,
}: {
  token: string,
  io?: Server | null

  event: 'userAfk' | 'userBack',
  extraData?: any
}) => {
  if (!io) { 
    console.log('no io instance found to inform room peers', 'red');
    return; 
  }

  const session = await getSession(token);
  if (session.code) {
    const roomSockets = io.sockets.adapter.rooms.get(session.code);
    console.log(roomSockets);
    
    for (const socketId of roomSockets || []) {
      const tempSocket = io.sockets.sockets.get(socketId as string);
      if (!tempSocket) { continue; }

      if (extraData?.ignoreSelf) {
        console.log(' skipping self emit ');
        
        const tempCookie = tempSocket.handshake.headers.cookie; // get the cookie from the socket connection
        const tempSessionToken = tempSocket.handshake.auth?.token
        const tempToken = tempCookie && process.env.VITE_SESSION_BASED_TOKEN === 'false' ? tempCookie.split("=")[1] 
          : tempSessionToken && process.env.VITE_SESSION_BASED_TOKEN === 'true' ? tempSessionToken
          : null; 

        if (token == tempToken) { continue; } //? we dont send the event to the client who called the event
      }

      if (event == 'userAfk') {
        console.log({ userId: session.id, endTime: Date.now() + (extraData?.time || 0) });
        tempSocket?.emit('userAfk', { userId: session.id, endTime: Date.now() + (extraData?.time || 0) });
      } else if (event == 'userBack') {
        tempSocket?.emit('userBack', { userId: session.id });
      }
    }
  }
}

export const initAcitivityBroadcaster = ({
  token,
  socket
}: {
  token: string,
  socket: Socket,
}) => {
  socket.on("intentionalDisconnect", async () => {
    clientSwitchedTab.add(token);
    const time = getDisconnectTime({ token, reason: undefined });

    await informRoomPeers({ token, event: 'userAfk', extraData: { time } });

    socket.disconnect(false);
  });
}