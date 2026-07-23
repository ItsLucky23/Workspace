import assert from 'node:assert/strict';

import {
  clearSocketMiddlewares,
  getSocketMiddlewares,
} from '@luckystack/core';
import type { Socket } from 'socket.io';

await import('../../config.ts');
const { registerWorkspacesTerminalHooks } = await import('../../server/hooks/workspacesTerminal.ts');

clearSocketMiddlewares();
registerWorkspacesTerminalHooks();

const middleware = getSocketMiddlewares()[0];
assert.ok(middleware);

const anonymousSocket = {
  handshake: {
    auth: {},
    headers: {},
  },
} as Socket;

const rejection = await new Promise<Error | undefined>((resolve) => {
  middleware(anonymousSocket, (error?: Error) => { resolve(error); });
});

assert.equal(rejection, undefined, 'anonymous login/register sockets must pass the terminal middleware');

console.log('workspaces terminal socket middleware unit tests passed');
