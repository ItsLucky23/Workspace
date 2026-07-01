import { io, ManagerOptions, SocketOptions } from 'socket.io-client';
import {
  backendUrl,
  logging,
  SessionLayout,
  sessionBasedToken,
  socketActivityBroadcaster,
  locationProviderEnabled,
  loginPageUrl,
} from "config";
import {
  i18nNotify as notify,
  clearCsrfToken,
  socket,
  setSocket,
  incrementResponseIndex,
  waitForSocket,
  socketEventNames,
  buildGetJoinedRoomsResponseEventName,
  buildJoinRoomResponseEventName,
  buildLeaveRoomResponseEventName,
  tryCatch,
} from "@luckystack/core/client";
import { useSocketStatus } from "../_providers/socketStatusProvider";
import { useEffect, useRef } from "react";
import { initSyncRequest } from "./syncRequest";
import { flushApiQueue, flushSyncQueue, isOnline } from "./offlineQueue";

//? The incoming `sync` socket listener + its route-key helpers now live in
//? `@luckystack/sync/client` (`attachSyncReceiver`), dynamic-imported below so a
//? base install without `@luckystack/sync` still builds + runs.

const setDisconnectedStatus = (setSocketStatus: ReturnType<typeof useSocketStatus>["setSocketStatus"]) => {
  setSocketStatus(prev => ({
    ...prev,
    self: {
      status: "DISCONNECTED",
      reconnectAttempt: undefined,
      endTime: undefined,
    }
  }));
};

const isLocationProviderEnabled: boolean = locationProviderEnabled;
const shouldLogDev = logging.devLogs;
const shouldNotifyDev = logging.devNotifications;
const shouldLogSocketStatus = logging.socketStatus;

// Socket state (`socket`, `incrementResponseIndex`, `waitForSocket`) now
// lives in @luckystack/core/socketState — single source of truth shared with
// `apiRequest` (core) and `syncRequest` (sync). This React hook is the only
// place that assigns the socket via `setSocket(io(...))`. Re-exported below
// so existing callers that still import these symbols from this file keep
// working.
// eslint-disable-next-line unicorn/prefer-export-from
export { socket, incrementResponseIndex, waitForSocket };

export function useSocket(session: SessionLayout | null) {
  const { socketStatus, setSocketStatus } = useSocketStatus();
  const sessionRef = useRef(session);
  const socketStatusRef = useRef(socketStatus);

  useEffect(() => {
    sessionRef.current = session;
  }, [session])

  useEffect(() => {
    socketStatusRef.current = socketStatus;
  }, [socketStatus]);

  useEffect(() => {
    const socketOptions: Partial<ManagerOptions & SocketOptions> = {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
      autoConnect: true,
      withCredentials: true,
      auth: {}
    };

    if (sessionBasedToken) {
      const token = sessionStorage.getItem("token");
      if (token) {
        socketOptions.auth = { token };
      }
    }

    const socketConnection = io(backendUrl, socketOptions);
    setSocket(socketConnection);

    const canFlushQueue = () => socketConnection.connected && isOnline();

    const handleVisibility = () => {
      if (!socketActivityBroadcaster) { return; }

      if (shouldLogSocketStatus) {
        console.log(document.visibilityState);
      }

      //? user switched tab or navigated away
      if (document.visibilityState === "hidden") {
        socketConnection.emit(socketEventNames.intentionalDisconnect);

        //? user switched back to the tab
      } else {
        if (socketStatusRef.current.self.status !== "CONNECTED") {
          socketConnection.connect();
        }
        socketConnection.emit(socketEventNames.intentionalReconnect);
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    //? Activity heartbeat: forward real user interaction (throttled to once per
    //? 10s) to the server so the activity-event system (built-in AFK detection
    //? + any custom pause/kick events) knows when the user is active. Idle =
    //? no events emitted = the server's last-activity ages past the AFK
    //? threshold and the registered event fires.
    let lastActivitySent = 0;
    const handleActivity = () => {
      if (!socketActivityBroadcaster) { return; }
      const now = Date.now();
      if (now - lastActivitySent < 10_000) { return; }
      lastActivitySent = now;
      socketConnection.emit(socketEventNames.activity);
    };
    const activityEvents = ["pointerdown", "pointermove", "keydown", "scroll", "wheel", "touchstart"];
    if (socketActivityBroadcaster) {
      for (const eventName of activityEvents) {
        globalThis.addEventListener(eventName, handleActivity, { passive: true });
      }
    }

    if (socketActivityBroadcaster) {
      void initSyncRequest({
        setSocketStatus,
        sessionRef,
      });
    } else {
      socketConnection.on(socketEventNames.connect, () => {
        if (shouldLogSocketStatus) {
          console.log("Connected to server");
        }
      });

      socketConnection.on(socketEventNames.disconnect, () => {
        if (shouldLogSocketStatus) {
          console.log("Disconnected, trying to reconnect...");
        }
      });

      socketConnection.on(socketEventNames.reconnectAttempt, (attempt) => {
        if (shouldLogSocketStatus) {
          console.log("Reconnecting attempt", attempt);
        }
      });

      socketConnection.on(socketEventNames.connectError, (err: { message: string }) => {
        if (shouldLogDev) {
          console.error(`Connection error: ${err.message}`);
        }
        if (shouldNotifyDev) {
          notify.error({ key: 'common.connectionError' });
        }
      });
    }

    socketConnection.on(socketEventNames.connect, () => {
      flushApiQueue(canFlushQueue, socketConnection);
      flushSyncQueue(canFlushQueue, socketConnection);
    });

    //? Session replaced elsewhere (single-session enforcement or
    //? maxConcurrentPerUser cap kicking the oldest device). Server fires
    //? this just before its standard logout emit, giving us a chance to
    //? surface a translated toast so the user understands why they're
    //? being logged out.
    socketConnection.on(socketEventNames.sessionReplaced, () => {
      notify.warning({ key: 'common.sessionReplacedElsewhere' });
    });

    socketConnection.on(socketEventNames.logout, (status: "success" | "error") => {
      if (status === "success") {
        //? Loud log so we can see in devtools exactly when the server told us
        //? to log out — paired with the server-side `[session] logout success`
        //? warn this lets us correlate trigger ↔ effect across the wire.
        console.warn(
          `[session] Server emitted logout — clearing sessionStorage and redirecting to ${loginPageUrl}. ` +
          `If you did not click logout, check the server terminal for the corresponding "[session] logout success" stacktrace.`,
        );
        if (sessionBasedToken) {
          sessionStorage.clear();
        }
        //? Drop the CSRF cache so the next login fetches a fresh token bound
        //? to the new session.
        clearCsrfToken();
        if (!sessionBasedToken) {
          //? Cookie mode: the socket transport cannot clear the HttpOnly
          //? session cookie — ask the server to expire it over HTTP (POST
          //? /auth/logout answers with a Max-Age=0 Set-Cookie) before the
          //? redirect. Redirect regardless of the request outcome: the
          //? session is already invalidated server-side.
          void (async () => {
            await tryCatch(() => fetch(`${backendUrl}/auth/logout`, { method: "POST", credentials: "include" }));
            globalThis.location.href = loginPageUrl;
          })();
          return;
        }
        globalThis.location.href = loginPageUrl;
      } else {
        console.error("Logout failed");
        notify.error({ key: 'common.logoutFailed' });
      }
    });

    //? Sync receive bridge. The incoming `sync` listener lives in
    //? `@luckystack/sync/client` (`attachSyncReceiver`) so the consumer doesn't
    //? carry a copy of the dispatch logic. Dynamic-imported + tryCatch so a base
    //? install WITHOUT `@luckystack/sync` simply runs without sync receive (no
    //? crash). Decoupled from the presence/activity flag — sync attaches whenever
    //? the package is present, independent of `socketActivityBroadcaster`.
    void (async () => {
      const [syncImportError, syncClient] = await tryCatch(() => import("@luckystack/sync/client"));
      if (syncImportError || !syncClient) {
        if (shouldLogDev) {
          console.log("[sync] @luckystack/sync/client not installed — sync receive disabled.");
        }
        return;
      }
      syncClient.attachSyncReceiver(socketConnection);
    })();


    const handleOnline = () => {
      if (socketConnection.connected) {
        flushApiQueue(canFlushQueue, socketConnection);
        flushSyncQueue(canFlushQueue, socketConnection);
        return;
      }
      socketConnection.connect();
    };

    globalThis.addEventListener("online", handleOnline);

    return () => {
      if (socket) {
        socket.disconnect();
        setSocket(null);
        setDisconnectedStatus(setSocketStatus);
      }

      document.removeEventListener("visibilitychange", handleVisibility)
      globalThis.removeEventListener("online", handleOnline)
      for (const eventName of activityEvents) {
        globalThis.removeEventListener(eventName, handleActivity);
      }
    };

  }, [setSocketStatus]);

  return socket;
}


// `waitForSocket` moved to @luckystack/core/socketState — re-exported at the
// top of this file to keep the existing symbol visible to callers.

export const joinRoom = async (group: string) => {
  return new Promise<{ success: true; rooms: string[] } | null>((resolve) => {
    void (async () => {
      if (!group || typeof group !== "string") {
        if (shouldLogDev) {
          console.error("Invalid group");
        }
        if (shouldNotifyDev) {
          notify.error({ key: 'common.invalidGroup' });
        }
        resolve(null);
        return;
      }

      if (!await waitForSocket()) {
        resolve(null);
        return;
      }
      if (!socket) {
        resolve(null);
        return;
      }

      const tempIndex = incrementResponseIndex();
      socket.emit(socketEventNames.joinRoom, { group, responseIndex: tempIndex });

      socket.once(buildJoinRoomResponseEventName(tempIndex), (response?: { status?: string; errorCode?: string; message?: string; rooms?: unknown }) => {
        //? The server emits `normalizeErrorResponse(...)` on failures, which has
        //? shape `{status:'error', errorCode, message, ...}` — NOT `{error}`.
        //? Treat any envelope with status:'error' or a non-empty errorCode as a
        //? failure so the spurious "you haven't joined" warning stops firing on
        //? auth/session errors that previously fell through the success branch.
        const errorCode = typeof response?.errorCode === 'string' ? response.errorCode : '';
        if (response?.status === 'error' || errorCode.length > 0) {
          const key = errorCode || 'common.unknownError';
          if (shouldLogDev) {
            console.error(`[joinRoom] ${key}${response?.message ? `: ${response.message}` : ''}`);
          }
          if (shouldNotifyDev) {
            notify.error({ key });
          }
          resolve(null);
          return;
        }

        const rooms = Array.isArray(response?.rooms)
          ? response.rooms.filter((room): room is string => typeof room === 'string')
          : [];

        resolve({ success: true, rooms });
      });
    })();
  });
}

export const leaveRoom = async (group: string) => {
  return new Promise<{ success: true; rooms: string[] } | null>((resolve) => {
    void (async () => {
      if (!group || typeof group !== "string") {
        if (shouldLogDev) {
          console.error("Invalid group");
        }
        if (shouldNotifyDev) {
          notify.error({ key: 'common.invalidGroup' });
        }
        resolve(null);
        return;
      }

      if (!await waitForSocket()) {
        resolve(null);
        return;
      }
      if (!socket) {
        resolve(null);
        return;
      }

      const tempIndex = incrementResponseIndex();
      socket.emit(socketEventNames.leaveRoom, { group, responseIndex: tempIndex });

      socket.once(buildLeaveRoomResponseEventName(tempIndex), (response?: { status?: string; errorCode?: string; message?: string; rooms?: unknown }) => {
        const errorCode = typeof response?.errorCode === 'string' ? response.errorCode : '';
        if (response?.status === 'error' || errorCode.length > 0) {
          const key = errorCode || 'common.unknownError';
          if (shouldLogDev) {
            console.error(`[leaveRoom] ${key}${response?.message ? `: ${response.message}` : ''}`);
          }
          if (shouldNotifyDev) {
            notify.error({ key });
          }
          resolve(null);
          return;
        }

        const rooms = Array.isArray(response?.rooms)
          ? response.rooms.filter((room): room is string => typeof room === 'string')
          : [];

        resolve({ success: true, rooms });
      });
    })();
  });
}

export const getJoinedRooms = async () => {
  return new Promise<string[] | null>((resolve) => {
    void (async () => {
      if (!await waitForSocket()) {
        resolve(null);
        return;
      }
      if (!socket) {
        resolve(null);
        return;
      }

      const tempIndex = incrementResponseIndex();
      socket.emit(socketEventNames.getJoinedRooms, { responseIndex: tempIndex });

      socket.once(buildGetJoinedRoomsResponseEventName(tempIndex), (response?: { status?: string; errorCode?: string; message?: string; rooms?: unknown }) => {
        const errorCode = typeof response?.errorCode === 'string' ? response.errorCode : '';
        if (response?.status === 'error' || errorCode.length > 0) {
          const key = errorCode || 'common.unknownError';
          if (shouldLogDev) {
            console.error(`[getJoinedRooms] ${key}${response?.message ? `: ${response.message}` : ''}`);
          }
          if (shouldNotifyDev) {
            notify.error({ key });
          }
          resolve(null);
          return;
        }

        const rooms = Array.isArray(response?.rooms)
          ? response.rooms.filter((room): room is string => typeof room === 'string')
          : [];

        resolve(rooms);
      });
    })();
  });
}

export const updateLocationRequest = async ({ location }: { location: { pathName: string, searchParams: Record<string, string> } }) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- this guard is required because deployments can toggle locationProviderEnabled
  if (!isLocationProviderEnabled) { return null; }

  if (!location.pathName) {
    if (shouldLogDev) {
      console.error("Invalid location");
    }
    if (shouldNotifyDev) {
      notify.error({ key: 'common.invalidLocation' });
    }
    return null;
  }

  if (!await waitForSocket()) { return null; }
  if (!socket) { return null; }

  socket.emit(socketEventNames.updateLocation, location);
  return null;
}