import { ClientSyncProps } from "config";

const main = ({ user }: ClientSyncProps) => {
  //? here you can do certain checks for each user and determine if they should get the event or not
  //? e.g. user.admin == true or user.location.pathName == '/test'
  console.log(user)
  if (user?.location?.pathName == '/test') {
    return {
      status: 'success',
    };
  }
}

export { main }