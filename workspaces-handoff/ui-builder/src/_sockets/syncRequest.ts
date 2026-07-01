import { dev, SessionLayout } from "config";
import { toast } from "sonner";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
import { statusContent } from "src/_providers/socketStatusProvider";
import { Dispatch, RefObject, SetStateAction } from "react";

const syncEvents: Record<string, ((params: { clientData: any; serverData: any; aditionalData: any }) => void)> = {};

type syncRequestType = {
  name: string;
  data?: object | null;
  receiver: any;
  ignoreSelf?: boolean;
}

export const syncRequest = async ({ name, data, receiver, ignoreSelf }: syncRequestType) => {
  return new Promise(async (resolve) => {
    if (!name || typeof name !== "string") {
      if (dev) {
        console.error("Invalid name for syncRequest");
        toast.error("Invalid name for syncRequest");
      }
      return resolve(null);
    }
  
    if (!data || typeof data !== "object") {
      data = {};
    }
  
    if (!receiver) {
      if (dev) {
        console.error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets wich we dont recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
        toast.error("You need to provide a receiver for syncRequest, this can be either 'all' to trigger all sockets wich we dont recommend or it can be any value such as a code e.g 'Ag2cg4'. this works together with the joinRoom and leaveRoom function");
      }
      return resolve(null);
    }
  
    if (!await waitForSocket()) { return resolve(null); }
    if (!socket) { return resolve(null); }
    
    const tempIndex = incrementResponseIndex();
    const pathname = window.location.pathname;
    const fullName = `sync${pathname}/${name}`;
    //? example: api/games/boerZoektVrouw/getGameData
  
    if (dev) { console.log(`Client Sync Request: `, { name, data, receiver, ignoreSelf }) }
  
    socket.emit('sync', { name: fullName, data, cb: name, receiver, responseIndex: tempIndex, ignoreSelf });

    socket.once(`sync-${tempIndex}`, (data: { status: "success" | "error", message: string }) => {
      if (data.status === "error") {
        if (dev) {
          console.error(`Sync ${name} failed: ${data.message}`);
          toast.error(`Sync ${name} failed: ${data.message}`);
        }
        return resolve(false);
      }
      resolve(data.status == "success");
    });
  })
}

export const useSyncEvents = () => {

  const upsertSyncEventCallback = (name: string, cb: (params: { clientData: any; serverData: any; }) => void) => {
    const path = window.location.pathname;
    syncEvents[`sync${path}/${name}`] = cb;
  }

  return { upsertSyncEventCallback };
}

export const useSyncEventTrigger = () => {

  const triggerSyncEvent = (name: string, clientData: any = {}, serverData: any = {}, aditionalData: any = {}) => {
    const cb = syncEvents[name];
    if (!cb) {
      if (dev) {
        console.log(syncEvents)
        console.error(`Sync event ${name} not found`);
        toast.error(`Sync event ${name} not found`);
      }
      return;
    }
    if (typeof cb == 'function') {
      cb({ clientData, serverData, aditionalData });
    }
  }

  return { triggerSyncEvent }
}

export const initSyncRequest = async ({
  socketStatus, 
  setSocketStatus,
  sessionRef
}: {
  socketStatus: {
    self: statusContent;
    [userId: string]: statusContent;
  };
  setSocketStatus: Dispatch<
    SetStateAction<{
      self: statusContent;
      [userId: string]: statusContent;
    }>
  >;
  sessionRef: RefObject<SessionLayout> | null;
}) => {

  if (!await waitForSocket()) { return; }
  if (!socket) { return; }
  if (!sessionRef) { return; }

  socket.on("connect", () => {
    console.log(socketStatus)
    console.log("Connected to server");
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "CONNECTED",
        // reconnectAttempt: undefined,
      }
    }));
  });

  socket.on("disconnect", () => {
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "DISCONNECTED",
      }
    }));
    console.log("Disconnected, trying to reconnect...");
  });

  socket.on("reconnect_attempt", (attempt) => {
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "RECONNECTING",
        reconnectAttempt: attempt,
      }
    }));
    console.log(`Reconnecting attempt ${attempt}...`);
  });

  //? will not trigger when you call this event
  socket.on("userAfk", ({ userId, endTime }) => {
    if (userId == sessionRef.current?.id) { 
      setSocketStatus(prev => ({
        ...prev,
        self: {
          status: "DISCONNECTED",
          reconnectAttempt: undefined,
          endTime
        }
      }));
    } else {
      setSocketStatus(prev => ({
        ...prev,
        [userId]: {
          status: "DISCONNECTED",
          endTime
        }
      }));
    }
  });

  //? will not trigger when you call this event
  socket.on("userBack", ({ userId }) => {
    console.log("userBack", { userId });
    
    setSocketStatus(prev => {
      const newStatus = { ...prev };
      newStatus[userId] = {
        status: "CONNECTED",
        endTime: undefined,
      };
      return newStatus;
    });
  });

  socket.on("connect_error", (err) => {
    console.log("connect_error", { err });
    setSocketStatus(prev => ({
      ...prev,
      self: {
        ...prev.self,
        status: "DISCONNECTED",
        reconnectAttempt: undefined,
      }
    }));
    if (dev) {
      console.error(`Connection error: ${err.message}`);
      toast.error(`Connection error: ${err.message}`);
    }
  });

}