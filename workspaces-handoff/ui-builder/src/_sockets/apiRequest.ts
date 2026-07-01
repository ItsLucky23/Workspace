import { dev } from "config";
import { toast } from "sonner";
import { incrementResponseIndex, socket, waitForSocket } from "./socketInitializer";
const env = import.meta.env;

//? if we use apiRequest function and the called api name starts with 1 of the names below we apply a abort controller
const abortControllers = new Map<string, AbortController>();
const abortControllerNames = ['get', 'fetch', 'load', 'is', 'has', 'list', 'all', 'search', 'view', 'retrieve'];

interface apiRequestType {
  name: string;
  data?: object;
}

export interface apiRequestReponse {
  status: 'success' | 'error' | any;
  result?: Record<string, any> | any;
  message?: string;
  messageParams?: Record<string, any>;
}

export const apiRequest = ({ name, data }: apiRequestType) => {
  return new Promise(async (resolve, reject) => {
    if (!name || typeof name !== "string") {
      if (dev) {
        console.error("Invalid name");
        toast.error("Invalid name");
      }
      return resolve(null);
    }

    if (!data || typeof data !== "object") {
      data = {};
    }

    if (!await waitForSocket()) { return resolve(null); }
    if (!socket) { return resolve(null); }
  
    const useAbortController = abortControllerNames.some((tempName) => name.startsWith(tempName)) && env.VITE_SESSION_BASED_TOKEN != 'true';
    const pathname = window.location.pathname;
    const fullname = name != 'session' && name != 'logout' ? `api${pathname}/${name}` : name;
    // example: api/games/boerZoektVrouw/getGameData
  
    let signal: AbortSignal | null = null;
    let abortFunc = () => {};

    if (useAbortController) {
      if (abortControllers.has(fullname)) {
        //? if we have an abort controller we abort it and create a new one
        const prevAbortController = abortControllers.get(fullname);
        prevAbortController?.abort();
      }
      //? here we create a new abort controller and add it to the map with the api fullname as the key
      const abortController = new AbortController();
      abortControllers.set(fullname, abortController);
      abortFunc = () => {
        if (signal) { signal.removeEventListener("abort", abortFunc); }
        reject(`Request ${fullname} aborted`)
      };
      //? here we bind the abortFunc to the abort event so it will be called when the abort controller is aborted
      signal = abortController.signal;
      signal.addEventListener("abort", abortFunc);
    }

    const tempIndex = incrementResponseIndex();
    socket.emit('apiRequest', { name: fullname, data, responseIndex: tempIndex });
    
    if (dev && name != 'session' && name != 'logout') { console.log(`Client API Request(${tempIndex}): `, { name, data }) }
    socket.once(`apiResponse-${tempIndex}`, ({ result, message, status }: {
      result: any;
      message: string;
      status: "success" | "error";
    }) => {
      if (signal && signal.aborted) { return; }

      if (status === "error") {
        if (dev) {
          console.error('message:', message);
          toast.error(message);
        }
        return resolve({
          status,
          message
        })
      }

      if (dev && name != 'session' && name != 'logout') { console.log(`Server API Response(${tempIndex}): `, { name, ...result }) }
      if (dev && name == 'session') { console.log(`Session result(${tempIndex}): `, result) }
      if (dev && name == 'logout') { console.log(`Logout result(${tempIndex}): `, result) }

      if (signal) {
        signal.removeEventListener("abort", abortFunc);
        abortControllers.delete(fullname);
      }
      
      resolve(result)
    });
  })
}