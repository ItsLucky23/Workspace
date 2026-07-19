//? intent: the /workspaces entry point — forwards to the Develop board, the canonical home of a
//? workspace. A thin redirect so the login flow, the PWA and old bookmarks keep landing somewhere
//? real after the category restructure (develop / content / insights).
import { Navigate } from 'react-router';

export const template = 'plain';

export default function WorkspacesIndex() {
  return <Navigate to="/workspaces/develop/board" replace />;
}
