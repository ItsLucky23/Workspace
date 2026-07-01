/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */

//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
import { Functions, SyncClientResponse, SyncClientInput, SyncServerOutput, MaybePromise, SyncClientStreamEmitter } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

// Types are imported from the generated file based on the _server_v{number}.ts definition
type PagePath = '{{PAGE_PATH}}';
type SyncName = '{{SYNC_NAME}}';

export interface SyncParams {
  clientInput: SyncClientInput<PagePath, SyncName>;
  serverOutput: SyncServerOutput<PagePath, SyncName>;
  token: string | null; // target client's session token (fetch session only when needed)
  functions: Functions; // contains all functions that are available on the server in the functions folder
  roomCode: string; // room code
  stream: SyncClientStreamEmitter;
}

export const main = ({  }: SyncParams): MaybePromise<SyncClientResponse> => {
  // PAIRED SYNC: Types are shared with the _server_v{number}.ts file
  // clientInput type comes from _server_v{number}.ts SyncParams
  // serverOutput type is inferred from _server_v{number}.ts return value
  // stream payload types are generated from your stream(...) calls in this file
  // Use functions.session.getSession(token) when you need session data for this target client.
  // Returning error here only affects the current target client and does not stop other clients.

  // Example: Only allow users on set page to receive the event
  // const targetUser = token ? await functions.session.getSession(token) : null;
  // if (targetUser?.location?.pathName === '/your-page') {
  //   return { status: 'success' };
  // }

  return {
    status: 'success',
    // Add any additional data to pass to the client
  };
};
