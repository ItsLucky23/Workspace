import dotenv from 'dotenv';
import { tryCatch } from '../functions/tryCatch';

dotenv.config(); // Load environment variables from .env file

interface BasicProvider {
  name: string;
}

interface FullProvider {
  name: string,
  clientID: string,
  clientSecret: string,
  callbackURL: string,
  authorizationURL: string,
  tokenExchangeURL: string,
  tokenExchangeMethod: 'json' | 'form',
  userInfoURL: string,
  scope: string[],
  getEmail?: (access_token: string) => Promise<string | false | undefined>,
  nameKey: string,
  emailKey: string, 

  avatarKey?: string, //? the avatarKey represent the url to the img
  avatarCodeKey: string, //? the avatarCodeKey should be the key representing the avatar id if the provider doesnt give the avatar url directly, we use the getAvatar function with this value together
  getAvatar?: ({userData, avatarId}: {userData: Record<string, any>, avatarId: string}) => any
}

type oauthProvidersProps = | BasicProvider | (Required<FullProvider>); 

// const backendUrl = `http${process.env.SECURE == 'true' ? 's' : ''}://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`;
const prod = process.env.NODE_ENV !== 'development';
const backendUrl = process.env.NODE_ENV == 'development' 
  ? `http${process.env.SECURE == 'true' ? 's' : ''}://${process.env.SERVER_IP}:${process.env.SERVER_PORT}`
  : process.env.DNS
  
const oauthProviders: oauthProvidersProps[] = [
  {
    name: 'credentials',
  },
  {
    name: 'google',
    clientID: prod ?  process.env.GOOGLE_CLIENT_ID : process.env.DEV_GOOGLE_CLIENT_ID,
    clientSecret: prod ?  process.env.GOOGLE_CLIENT_SECRET : process.env.DEV_GOOGLE_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/callback/google`,
    authorizationURL: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenExchangeURL: 'https://oauth2.googleapis.com/token',
    tokenExchangeMethod: 'json',
    userInfoURL: 'https://www.googleapis.com/oauth2/v1/userinfo',
    scope: [
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/userinfo.email"
    ],
    nameKey: 'name',
    emailKey: 'email',
    avatarKey: 'picture'
  },
  {
    name: 'github',
    clientID: prod ?  process.env.GITHUB_CLIENT_ID : process.env.DEV_GITHUB_CLIENT_ID,
    clientSecret: prod ?  process.env.GITHUB_CLIENT_SECRET : process.env.DEV_GITHUB_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/callback/github`,
    authorizationURL: 'https://github.com/login/oauth/authorize',
    tokenExchangeURL: 'https://github.com/login/oauth/access_token',
    tokenExchangeMethod: 'json',
    userInfoURL: 'https://api.github.com/user',
    scope: ['read:user', 'user:email'],
    nameKey: 'login',
    emailKey: 'email',
    avatarKey: 'avatar_url',
    getEmail: async (access_token: string) => {
      const getEmail = async () => {
        const url = 'https://api.github.com/user/emails';
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${access_token}`
          },
        })
        return await response.json(); 
      }
  
      const [getEmailError, getEmailResponse] = await tryCatch(getEmail);
      if (getEmailError) {
        console.log(getEmailError);
        return false;
      }
  
      //? if we found the email we set it to the user object
      let mainEmail: string | undefined;
      for (const email of getEmailResponse) {
        if (email.primary) { mainEmail = email.email; }
      }
      if (!mainEmail) { mainEmail = getEmailResponse?.[0]?.email; }
      return mainEmail;
    },
  },
  {
    name: 'discord',
    clientID: prod ?  process.env.DISCORD_CLIENT_ID : process.env.DEV_DISCORD_CLIENT_ID,
    clientSecret: prod ?  process.env.DISCORD_CLIENT_SECRET : process.env.DEV_DISCORD_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/callback/discord`,
    authorizationURL: 'https://discord.com/oauth2/authorize',
    tokenExchangeURL: 'https://discord.com/api/oauth2/token',
    tokenExchangeMethod: 'form',
    userInfoURL: 'https://discord.com/api/users/@me',
    scope: [
      "identify",
      'email',
    ],
    nameKey: 'username',
    emailKey: 'email',
    avatarCodeKey: 'avatar',
    getAvatar: ({userData, avatarId}: {userData: Record<string, any>, avatarId: string}) => {
      if (!avatarId) {
        // Default avatar (based on discriminator % 5)
        // const defaultAvatarIndex = userId % 5;
        // return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
        return undefined;
      }
      const userId = userData.id;
      const format = avatarId.startsWith("a_") ? "gif" : "png";
      return `https://cdn.discordapp.com/avatars/${userId}/${avatarId}.${format}`;
    }
  },
  {
    name: 'facebook',
    clientID: prod ?  process.env.FACEBOOK_CLIENT_ID : process.env.DEV_FACEBOOK_CLIENT_ID,
    clientSecret: prod ?  process.env.FACEBOOK_CLIENT_SECRET : process.env.DEV_FACEBOOK_CLIENT_SECRET,
    callbackURL: `${backendUrl}/auth/callback/facebook`,
    authorizationURL: 'https://www.facebook.com/v10.0/dialog/oauth',
    tokenExchangeURL: 'https://graph.facebook.com/v10.0/oauth/access_token',
    tokenExchangeMethod: 'form',
    userInfoURL: 'https://graph.facebook.com/me?fields=id,name,email,picture.type(large)',
    scope: ['public_profile', 'email'],
    nameKey: 'name',
    emailKey: 'email',
    getAvatar: ({userData}: {userData: Record<string, any>}) => {
      return userData?.picture?.data?.url || undefined;
    }
  },
];

export default oauthProviders;