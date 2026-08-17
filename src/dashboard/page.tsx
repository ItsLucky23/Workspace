//? intent: A legacy entry point, kept only so old bookmarks and links to `/dashboard` keep
//? working — it renders nothing and sends the visitor straight to the Workspaces landing,
//? which is this product's real home. It used to be the framework's untouched sample page
//? (a bare heading + paragraph with no chrome), which read as a broken dead end.

import { Navigate } from 'react-router';

import type { PageMiddleware } from '@luckystack/core/client';
import type { SessionLayout } from '../../config';

const Dashboard = () => <Navigate to="/workspaces" replace />;

export const template = 'plain' as const;

//? Per-page route guard. Logged-out visitors bounce to `/login` before the redirect runs.
export const middleware: PageMiddleware<SessionLayout> = ({ session }) => {
  if (!session) return { success: false, redirect: '/login' };
  return { success: true };
};

export default Dashboard;
