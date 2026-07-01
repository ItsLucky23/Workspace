//? Workspaces — the board (index route `/workspaces`). The persistent shell +
//? shared-state provider come from the `workspaces` template; this route only
//? supplies the screen. Sibling views live in their own folders
//? (`backlog/`, `pipeline/`, …, `board/[ticketId]/`). Dummy data for now.

import Board from './_screens/Board';

export const template = 'workspaces';

export default function BoardPage() {
  return <Board />;
}
