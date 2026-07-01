//? Root route (`/`). Sends visitors to the app's main surface — the dashboard
//? when signed in, the login page otherwise. This is also where OAuth logins land
//? after the callback redirects to the public origin; without it, `/` would fall
//? through to the catch-all ErrorPage.

import type { PageMiddleware } from "@luckystack/core/client";
import { loginPageUrl, loginRedirectUrl, type SessionLayout } from "config";

export const template = 'plain';

export const middleware: PageMiddleware<SessionLayout> = ({ session }) =>
  session
    ? { success: false, redirect: loginRedirectUrl }
    : { success: false, redirect: loginPageUrl };

//? Never rendered — the middleware always redirects first.
export default function Index() {
  return null;
}
