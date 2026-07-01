import { PrismaClient } from '@prisma/client';
import { AuthProps, SessionLayout } from 'config';

interface Functions {
  prisma: PrismaClient;

  saveSession: (sessionId: string, data: any) => Promise<boolean>;
  getSession: (sessionId: string) => Promise<any | null>;
  deleteSession: (sessionId: string) => Promise<boolean>;

  tryCatch: <T, P>(func: (values: P) => Promise<T> | T, params?: P) => Promise<[any, T | null]>;

  [key: string]: any; // allows for other functions that are not defined as a type but do exist in the functions folder
};

interface ApiParams {
  data: Record<string, any>;
  functions: Functions;
  user: SessionLayout;
};


const auth: AuthProps = {
  login: true, //? checks if the session data has an id. 
  additional: [
    // { key: 'groupId', mustBeFalsy: false }, //? checks if the groupId is truethy, so if groupId is an empty string or 0 it will not pass
    // { key: 'admin', value: true }, //? checks if admin = true
    // { key: 'email', type: 'string' }, //? checks if the email is a string
    // { key: 'updatedAt', nullish: false } //? checks if the updatedAt is not null or undefined 
    //? you can perform certain checks with more than 1 condition but in the end they all have there own use case.
  ]
}

const main = async ({ data, functions, user }: ApiParams) => {
  console.log(data)
  console.log(user)
  console.log('you just called the randomApi.ts')
  return { status: 'success', result: { name: 'John' } }
}

export { auth, main }