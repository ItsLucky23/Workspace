//? The `workspaces` page template: wraps every `/workspaces/*` route's content in
//? the shared state provider + the persistent shell chrome. Registered in
//? `src/_components/templates/TemplateProvider.tsx`. Because `main.tsx` keys the
//? template element by template NAME, this one instance stays mounted while you
//? navigate between the ws routes — so tabs / chat / nav-stack persist.

//? The workspaces-scoped stylesheet (the `ws-no-scrollbar` utility). This import was lost in the
//? prototype port, silently turning every ws-no-scrollbar usage into a no-op — visible scrollbars
//? under the tab/stage strips. The template is the one place that wraps every /workspaces route.
import '../workspaces.css';

import { WorkspacesProvider } from './WorkspacesProvider';
import { WorkspacesShell } from './WorkspacesShell';

export default function WorkspacesTemplate({ children }: { children: React.ReactNode }) {
  return (
    <WorkspacesProvider>
      <WorkspacesShell>{children}</WorkspacesShell>
    </WorkspacesProvider>
  );
}
