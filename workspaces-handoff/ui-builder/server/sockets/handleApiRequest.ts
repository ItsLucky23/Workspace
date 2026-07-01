import { tryCatch } from '../functions/tryCatch';
import { apis, functions } from '../prod/generatedApis'
import { devApis, devFunctions } from "../dev/loader"
import { apiMessage } from './socket';
import { getSession } from '../functions/session';
import type { SessionLayout } from '../../config';
import { Socket } from 'socket.io';
import { logout } from './utils/logout';

type handleApiRequestType = {
  msg: apiMessage,
  socket: Socket,
  token: string | null,
}

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
          status: "error",
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
            status: "error",
            message: `Expected ${condition.key} to be null or undefined`,
          };
        }
        if (!condition.nullish && isNullish) {
          return {
            status: "error",
            message: `Expected ${condition.key} to be not null and not undefined`,
          };
        }
      }

      //? Check type if specified (skip null or undefined values)
      if (condition.type && val != null) {
        if (typeof val !== condition.type) {
          return {
            status: "error",
            message: `Expected ${condition.key} to be of type ${condition.type}`,
          };
        }
      }

      //? Check exact value if specified (strict equality)
      if ('value' in condition) {
        if (val !== condition.value) {
          return {
            status: "error",
            message: `Expected ${condition.key} to equal ${JSON.stringify(condition.value)}`,
          };
        }
      }

      //? Check truthy/falsy if specified
      if (typeof condition.mustBeFalsy === 'boolean') {
        if (condition.mustBeFalsy && !isFalsy(val)) {
          return {
            status: "error",
            message: `Expected ${condition.key} to be falsy`,
          };
        }
        if (!condition.mustBeFalsy && isFalsy(val)) {
          return {
            status: "error",
            message: `Expected ${condition.key} to be truthy`,
          };
        }
      }
    }
  
  }
  return {
    status: "success"
  }
}

// export default async function handleApiRequest({ name, data, user }: handleApiRequestType) {
export default async function handleApiRequest({ msg, socket, token }: handleApiRequestType) {
  // console.log(msg)
  //? this event gets triggerd when the client uses the apiRequest function from serverRequest.ts
  //? we check if the msg contains a name and check if there is a api that exist with this name
  if (typeof msg != 'object' ) {
    console.log('socket message was not a json object!!!!', 'red')
    console.log('socket message was not a json object!!!!', 'red')
    console.log('socket message was not a json object!!!!', 'red')
    return;
  }

  const { name, data, responseIndex } = msg;
  const user = await getSession(token)

  if (!responseIndex && typeof responseIndex !== 'number') {
    console.log('no response index given!!!!', 'red')
    console.log('no response index given!!!!', 'red')
    console.log('no response index given!!!!', 'red')
    return;
  }

  //? if the name of the apiRequest is 'session' we return the users session data else we check if there is an api with this name
  if (name == 'session') {
    return socket.emit(`apiResponse-${responseIndex}`, { result: user });
  }

  if (name == 'logout') {
    await logout({ token, socket, userId: user?.id || null });
    return socket.emit(`apiResponse-${responseIndex}`, { result: true });
  }

  if (!name || !data || typeof name != 'string' || typeof data != 'object') {
    return socket.emit(`apiResponse-${responseIndex}`, { status: "error" , message: `socket message was incomplete, needs a name ${name} and data: ${JSON.stringify(data)}` });
  }

  console.log(' ', 'blue')
  console.log(' ', 'blue')
  console.log(`api: ${name} called`, 'blue');

  const apisObject = process.env.NODE_ENV == 'development'? devApis : apis;

  //? check if there exist a function with the given name
  if (!apisObject[name]) { return socket.emit(`apiResponse-${responseIndex}`, { status: "error", message: 'api not found' }); }

  const { auth, main } = apisObject[name];

  //? if the login key is true we check if the user has an id in the session object
  if (auth.login) { 
    if (!user?.id) { 
      console.log(`ERROR!!!, not logged in but api call requires login`, 'red');
      return socket.emit(`apiResponse-${responseIndex}`, { status: "error", message: 'not logged in but api call requires login' }); 
    }
  }

  const notValid = validateRequest({ auth, user: user as SessionLayout });
  if (!notValid || notValid?.status === "error") { return socket.emit(`apiResponse-${responseIndex}`, notValid); }

  //? All checks passed so we call the api function and return the result
  const functionsObject = process.env.NODE_ENV == 'development' ? devFunctions : functions;
  const [error, result] = await tryCatch(async () => await main({ data, user, functions: functionsObject }));
  if (error) { 
    console.log(error, 'red'); 
    socket.emit(`apiResponse-${responseIndex}`, { status: "error", message: error });
  } else if (result) { 
    console.log(result, 'blue');
    socket.emit(`apiResponse-${responseIndex}`, { status: "success", result });
  } else {
    console.log('api didnt return anything', 'red');
    socket.emit(`apiResponse-${responseIndex}`, { status: "error", message: 'api didnt return anything' });
  }
}