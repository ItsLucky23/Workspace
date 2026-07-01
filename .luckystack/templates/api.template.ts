/* eslint-disable unicorn/no-abusive-eslint-disable */
/* eslint-disable */

//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
import { AuthProps, SessionLayout } from '{{REL_PATH}}config';
//@ts-ignore We replace {{REL_PATH}} with the relative path to the project root at scaffold time.
import { Functions, ApiResponse, MaybePromise, ApiStreamEmitter } from '{{REL_PATH}}src/_sockets/apiTypes.generated';

// Set the request limit per minute. Set to false to use the default config value config.rateLimiting
export const rateLimit: number | false = 20;

// HTTP method for this API. If not set, inferred from name (get* = GET, delete* = DELETE, else POST)
export const httpMethod: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST';

export const auth: AuthProps = {
  login: true,
  additional: []
};

export interface ApiParams {
  data: {
    // Define your input data shape here e.g.
    // name: string;
    // email: string;
  };
  user: SessionLayout;
  functions: Functions;
  stream: ApiStreamEmitter;
  //? Aborts on client-side cancel (`apiRequest({ signal })`) or socket
  //? disconnect. Check `abortSignal.aborted` in long-running loops and
  //? bail out — already-emitted chunks are not unsent, but new ones are
  //? short-circuited automatically.
  abortSignal: AbortSignal;
  //? Awaitable backpressure helper. Resolves once the originator socket's
  //? pending write-buffer drops below the threshold (default 1 MB). Opt-in;
  //? handlers that don't stream can ignore it.
  flushPressure: (options?: { thresholdBytes?: number }) => Promise<void>;
}

export const main = ({  }: ApiParams): MaybePromise<ApiResponse> => {
  // Stream payload types are generated from your stream(...) calls.
  // stream({ phase: 'started', progress: 0 });
  // stream({ phase: 'done', progress: 100, done: true });

  // Error responses must include errorCode
  // return { status: 'error', errorCode: 'api.someError', errorParams: [{ key: 'id', value: 1 }] };

  // Optional: set custom HTTP status on this response
  // return { status: 'success', httpStatus: 201 };

  return {
    status: 'success',
    // Your response data here
  };
};