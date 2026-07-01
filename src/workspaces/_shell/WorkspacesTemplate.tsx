//? The `workspaces` page template: wraps every `/workspaces/*` route's content in
//? the shared state provider + the persistent shell chrome. Registered in
//? `src/_components/templates/TemplateProvider.tsx`. Because `main.tsx` keys the
//? template element by template NAME, this one instance stays mounted while you
//? navigate between the ws routes — so tabs / chat / nav-stack persist.

import { WorkspacesProvider } from './WorkspacesProvider';
import { WorkspacesShell } from './WorkspacesShell';

export default function WorkspacesTemplate({ children }: { children: React.ReactNode }) {
  return (
    <WorkspacesProvider>
      <WorkspacesShell>{children}</WorkspacesShell>
    </WorkspacesProvider>
  );
}
