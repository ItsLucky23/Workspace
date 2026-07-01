import { AuthProps, ServerSyncProps } from "config";

const auth: AuthProps = {
  login: true,
  additional: []
}

const main = async ({ clientData }: ServerSyncProps) => {

  console.log(clientData);
  // here you can maybe update a counter in your server memory with redis or update your database cause this file only runs once

  return {
    status: 'success',
    increase: clientData.increase
  }
}

export { main, auth };