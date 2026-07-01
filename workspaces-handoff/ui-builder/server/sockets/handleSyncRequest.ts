import { tryCatch } from "../functions/tryCatch";
import { devSyncs, devFunctions } from "../dev/loader"
import { syncs, functions } from '../prod/generatedApis'
import { ioInstance, syncMessage } from "./socket";
import { Socket } from "socket.io";
import { getSession } from "../functions/session";
import { SessionLayout } from "config";

const functionsObject = process.env.NODE_ENV == 'development' ? devFunctions : functions;

const isFalsy = (value: any) => {
  return (
    value === false ||
    value === 0 ||
    value === 0n ||
    value === '' ||
    value === null ||
    value === undefined ||
    (typeof value === 'number' && isNaN(value))
  );
}

const validateRequest = ({ auth, user }: {
  auth: {
    login: boolean;
    additional?: {
      key: string;
      type?: 'string' | 'number' | 'boolean' | 'object' | 'function' | 'undefined';
      value?: any;
      mustBeFalsy?: boolean;
      nullish?: boolean;
    }[]
  }, 
  user: SessionLayout
}) => {

  //? if the additional key is an array we check if the following
  //? if it has a key and a type we check if the user has the key and if the value is of the correct type
  //? if it has a key and a value we check if the user has the key and if the value is the same as the given value
  //? examples:
  //? { key: 'admin', type: 'boolean' } -> checks if the user has the key admin and if the value is of type boolean
  //? { key: 'admin', value: true } -> checks if the user has the key admin and if the value is true   

  if (auth.additional) {
    for (const condition of auth.additional) {

      if (!condition.key) { 
        return {
          error: true,
          message: `Missing key in auth.additional condition`,
        };
      }

      if (!(condition.key in user)) {
        return { status: "error", message: `Key ${condition.key} not found in user session` };
      }

      const val = user?.[condition.key as keyof SessionLayout];

      //? If nullish flag is set, check accordingly
      if (typeof condition.nullish === 'boolean') {
        const isNullish = val === null || val === undefined;
        if (condition.nullish && !isNullish) {
          return {
            error: true,
            message: `Expected ${condition.key} to be null or undefined`,
          };
        }
        if (!condition.nullish && isNullish) {
          return {
            error: true,
            message: `Expected ${condition.key} to be not null and not undefined`,
          };
        }
      }

      //? Check type if specified (skip null or undefined values)
      if (condition.type && val != null) {
        if (typeof val !== condition.type) {
          return {
            error: true,
            message: `Expected ${condition.key} to be of type ${condition.type}`,
          };
        }
      }

      //? Check exact value if specified (strict equality)
      if ('value' in condition) {
        if (val !== condition.value) {
          return {
            error: true,
            message: `Expected ${condition.key} to equal ${JSON.stringify(condition.value)}`,
          };
        }
      }

      //? Check truthy/falsy if specified
      if (typeof condition.mustBeFalsy === 'boolean') {
        if (condition.mustBeFalsy && !isFalsy(val)) {
          return {
            error: true,
            message: `Expected ${condition.key} to be falsy`,
          };
        }
        if (!condition.mustBeFalsy && isFalsy(val)) {
          return {
            error: true,
            message: `Expected ${condition.key} to be truthy`,
          };
        }
      }
    }
  
  }
}


// export default async function handleSyncRequest({ name, clientData, user, serverData, roomCode }: syncMessage) {
export default async function handleSyncRequest({ msg, socket, token }: {
  msg: syncMessage,
  socket: Socket,
  token: string | null,
}) {

  if (!ioInstance) { return; }
  
  //? first we validate the data
  if (typeof msg!= 'object' ) {
    console.log('message','socket message was not a json object', 'red')
    return socket.emit('sync','socket message was not a json object');
  }

  const { name, data, cb, receiver, responseIndex, ignoreSelf } = msg;

  if (!name || !data || typeof name != 'string' || typeof data != 'object') {
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `socket message was incomplete, syncName: ${name}, syncData: ${JSON.stringify(data)}` })
  }

  if (!cb || typeof cb != 'string') {
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `socket message was incomplete, cb: ${cb}` });
  }
  
  if (!receiver) {
    console.log('receiver / roomCode: ', receiver, 'red')
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `socket message was incomplete, needs a receiver / roomCode: ${receiver}` });
  }

  console.log(' ', 'blue')
  console.log(' ', 'blue')
  console.log(`sync: ${name} called`, 'blue');

  const user = await getSession(token);
  const syncObject = process.env.NODE_ENV == 'development' ? devSyncs : syncs;

  console.log(syncObject)
  //? we check if there is a client file or/and a server file, if they both dont exist we abort
  if (!syncObject[`${name}_client`] && !syncObject[`${name}_server`]) { 
    console.log("ERROR!!!, ", `you need ${name}_client or ${name}_server file to sync`, 'red');
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `you need ${name}_client or ${name}_server file to sync` });
  }

  let serverData = {};
  if (syncObject[`${name}_server`]) {
    const { auth, main: serverMain } = syncObject[`${name}_server`];

    //? if the login key is true we check if the user has an id in the session object
    if (auth.login) { 
      if (!user?.id) { 
        console.log(`ERROR!!!, not logged in but sync requires login`, 'red');
        return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: 'not logged in but sync requires login' }); 
      }
    }

    const notValid = validateRequest({ auth, user: user as SessionLayout });
    if (notValid) { 
      console.log('ERROR!!!, ', notValid.message, 'red');
      return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, notValid); 
    }

    //? if the user has passed all the checks we call the preload sync function and return the result
    const [serverSyncError, serverSyncResult] = await tryCatch(async () => await serverMain({ clientData: data, user, functions: functionsObject, roomCode: receiver }));
    if (serverSyncError) {
      console.log('ERROR!!!, ', serverSyncError.message, 'red');
      return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: serverSyncError.message });
    } else if (serverSyncResult?.status == 'error') {
      console.log('ERROR!!!, ', serverSyncResult.message, 'red');
      return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: serverSyncResult.message });
    } else if (serverSyncResult?.status !== 'success') {
      //? badReturn means it doesnt include a status key with the value 'success' || 'error'
      console.log('ERROR!!!, ', `sync ${name}_server function didnt return a status key with the value 'success' or 'error'`, 'red');
      return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `sync ${name}_server function didnt return a status key with the value 'success' or 'error'` });
    } else if (serverSyncResult?.status == 'success') {
      serverData = serverSyncResult;
    }
  }

  //? from here on we can assume that we have either called a server sync and got a proper result of we didnt call a server sync

  //? get the desired sockets based on the receiver key
  const sockets = receiver === 'all'
    ? ioInstance.sockets.sockets //? all connected sockets (Map)
    : ioInstance.sockets.adapter.rooms.get(receiver) //? Set of socket IDs in room

  //? now we check if we found any sockets
  if (!sockets) { 
    console.log('data: ', msg, 'red');
    console.log('receiver: ', receiver, 'red');
    console.log('no sockets found', 'red');
    return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { status: "error", message: `no sockets found for receiver / roomCode: ${receiver}` });
  }

  //? here we loop over all the connected clients
  //? we keep track of an counter and await the loop every 100 iterations to avoid the server running out of memory and crashing
  let tempCount = 1;
  for (const socketEntry of sockets) {
    tempCount++;
    if (tempCount % 100 == 0) { await new Promise(resolve => setTimeout(resolve, 1)); }

    const tempSocket = receiver === 'all'
      ? (socketEntry as [string, Socket])[1] //? Map entry
      : ioInstance.sockets.sockets.get(socketEntry as string); //? socket ID from Set

    if (!tempSocket) { continue; }

    //? check if they have a token stored in there cookie or session based on the settings
    const tempCookie = tempSocket.handshake.headers.cookie; // get the cookie from the socket connection
    const tempSessionToken = tempSocket.handshake.auth?.token
    const tempToken = tempCookie && process.env.VITE_SESSION_BASED_TOKEN === 'false' ? tempCookie.split("=")[1] 
      : tempSessionToken && process.env.VITE_SESSION_BASED_TOKEN === 'true' ? tempSessionToken
      : null; 

    //? here we get the users session of the client and run the sync function with the data and the users session data
    const user = await getSession(tempToken);

    if (ignoreSelf && typeof ignoreSelf == 'boolean') {
      if (token == tempToken) {
        continue;
      }
    }

    if (syncObject[`${name}_client`]) {
      const [clientSyncError, clientSyncResult] = await tryCatch(async () => await syncObject[`${name}_client`]({ clientData: data, user, functions: functionsObject, serverData, roomCode: receiver }));
      // if (clientSyncError) { socket.emit(`sync-${responseIndex}`, { status: "error", message: clientSyncError }); }
      if (clientSyncError) { tempSocket.emit(`sync`, { status: "error", message: clientSyncError }) }
      //? if we return error we dont want this client to get the event
      else if (clientSyncResult?.status == 'error') { continue; }
      else if (clientSyncResult?.status == 'success') {
        const result = { 
          cb, 
          serverData, 
          clientData: clientSyncResult, 
          message: clientSyncResult.message || `${name} sync success`, 
          status: 'success' 
        };
        console.log(result, 'blue')
        tempSocket.emit(`sync`, result);
      } 
    } else {
      //? if there is no client function we still want to send the server data to the clients
      const result = { 
        cb, 
        serverData, 
        clientData: {}, 
        message: `${name} sync success`, 
        status: 'success' 
      };
      console.log(result, 'blue')
      tempSocket.emit(`sync`, result);
    }
  }

  return typeof responseIndex == 'number' && socket.emit(`sync-${responseIndex}`, { success: true, message: `sync ${name} success` });
}