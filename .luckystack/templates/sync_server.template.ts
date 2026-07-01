/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */

//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
import { AuthProps, SessionLayout } from '{{REL_PATH}}config';
//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
import { Functions, SyncServerResponse, MaybePromise, SyncServerStreamEmitter, SyncBroadcastStreamEmitter, SyncStreamToEmitter } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface SyncParams {
  clientInput: {
    // Define the data shape sent from the client e.g.
    // message: string;
    // targetUserId: string;
  };
  user: SessionLayout; // session data of the user who called the sync event
  functions: Functions; // functions object
  roomCode: string; // room code
  //? Stream primitives — pick whichever audience matches your use case:
  //?   stream            → originator only (cheapest)
  //?   broadcastStream   → every socket in the receiver room (live AI chat, collab)
  //?   streamTo          → specific session tokens only (selective subscribers)
  stream: SyncServerStreamEmitter;
  broadcastStream: SyncBroadcastStreamEmitter;
  streamTo: SyncStreamToEmitter;
  //? Aborts on client-side cancel (`syncRequest({ signal })`) or socket
  //? disconnect. Check `abortSignal.aborted` in long-running loops and bail
  //? out — already-emitted chunks are not unsent, but new ones are
  //? short-circuited automatically by the stream emitters.
  abortSignal: AbortSignal;
  //? Awaitable backpressure helper. Resolves once the worst-case write
  //? buffer across affected sockets drops below the threshold (default 1 MB).
  //? Use opt-in between batches of stream chunks to keep memory bounded.
  flushPressure: (options?: { thresholdBytes?: number }) => Promise<void>;
}

export const main = ({  }: SyncParams): MaybePromise<SyncServerResponse> => {
  // THIS FILE RUNS JUST ONCE ON THE SERVER

  // Stream payload types are generated from your stream(...) calls.
  // stream({ phase: 'validate', progress: 10 });           // → originator only
  // broadcastStream({ chunk: 'hello' });                   // → everyone in the room
  // streamTo([adminToken], { audit: 'event' });            // → specific tokens

  // For LLM token streams, coalesce small pieces with createStreamThrottle:
  //   import { createStreamThrottle } from '@luckystack/sync';
  //   const throttle = createStreamThrottle({ flushEveryMs: 50, flushAtChars: 32 });
  //   for await (const piece of aiStream) throttle.push(piece.text, broadcastStream);
  //   throttle.flush(broadcastStream);

  // Return { status: 'error', message: '...' } OR { status: 'error', errorCode: '...' }
  // Returning error here aborts the full sync flow.

  // Please validate clientInput here and dont just send the data back to the other clients
  // optional: database action or something else

  return {
    status: 'success',
    // Add any data you want to broadcast to clients
  };
};