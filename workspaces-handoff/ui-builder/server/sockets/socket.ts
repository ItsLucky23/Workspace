import dotenv from 'dotenv';
dotenv.config();

import handleApiRequest from "./handleApiRequest";
import { getSession, saveSession } from "../functions/session";
import { Server as SocketIOServer } from 'socket.io';
import handleSyncRequest from "./handleSyncRequest";
import allowedOrigin from '../auth/checkOrigin';
import { initAcitivityBroadcaster, socketConnected, socketDisconnecting, socketLeaveRoom } from './utils/activityBroadcaster';
import config, { SessionLayout } from '../../config';

export type apiMessage = {
  name: string;
  data: object;
  responseIndex: number;
}

export type syncMessage = {
  name: string;
  data: object;
  cb: string;
  receiver: string;
  responseIndex?: number;
  ignoreSelf?: boolean;
}

export let ioInstance: SocketIOServer | null = null;

export default function loadSocket(httpServer: any) {

  //? here we create the SocketIOServer instance
  const io = new SocketIOServer(httpServer, {
    cors: { 
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      origin: (origin, callback) => {
        if (!origin || allowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
    },
    maxHttpBufferSize: 5 * 1024 * 1024, // 5 MB
  });

  ioInstance = io;
  
  console.log('SocketIO server initialized', 'green');

  //? when a client connects to the SocketIO server we define there cookies and define some events to work with the exports of serverRequest.ts on the client
  io.on('connection', (socket) => {
    const cookie = socket.handshake.headers.cookie; // get the cookie from the socket connection
    const sessionToken = socket.handshake.auth?.token;
    const token = 
      cookie && process.env.VITE_SESSION_BASED_TOKEN === 'false' ? cookie.split("=")[1] 
      : sessionToken && process.env.VITE_SESSION_BASED_TOKEN === 'true'? sessionToken
      : null; 


    if (token) {
      socketConnected({ token, io });
    }

    socket.on('apiRequest', async (msg: apiMessage) => {
      handleApiRequest({ msg, socket, token });
    });
    socket.on('sync', async (msg: syncMessage) => {
      handleSyncRequest({ msg, socket, token });
    });
    socket.on('joinRoom', async (data) => {
      const { group, responseIndex } = data;
      await socket.join(group);
      await saveSession(token, { ...await getSession(token), code: group });
      socket.emit(`joinRoom-${responseIndex}`);
      console.log(`Socket ${socket.id} joined group ${group}`, 'cyan');
    });

    socket.on('disconnect', async (reason) => {
      if (config.socketActivityBroadcaster) {
        socketDisconnecting({ token, socket, reason });
      } else {
        if (!token) { return; }
        console.log(`user disconnected, reason: ${reason}`, 'yellow');
      }
    });

    socket.on('updateLocation', async (newLocation) => {
      console.log('updating location to: ', newLocation.pathName, 'yellow')

      let returnedUser: SessionLayout | undefined;
      if (config.socketActivityBroadcaster) {
        returnedUser = await socketLeaveRoom({ token, socket, newPath: newLocation.pathName });
      }

      if (!newLocation) { return; }
      const user = returnedUser || await getSession(token);
      if (!user) { return; }

      user.location = newLocation;
      return await saveSession(token, user);
    });

    if (config.socketActivityBroadcaster) {
      initAcitivityBroadcaster({ socket, token });
    }

    if (token) {
      socket.join(token);
    }
  
  });
  return io;
}