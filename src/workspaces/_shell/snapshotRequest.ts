//? Snapshot responses may complete out of order while the user switches workspace/project.
//? A response is applicable only when it is the newest request AND still targets the
//? latest desired scope. This keeps a delayed project-A response from replacing project B.

export interface SnapshotTarget {
  workspaceId: string | undefined;
  projectId: string | undefined;
}

export interface SnapshotRequestToken extends SnapshotTarget {
  sequence: number;
}

export function snapshotTargetsMatch(left: SnapshotTarget, right: SnapshotTarget): boolean {
  return left.workspaceId === right.workspaceId && left.projectId === right.projectId;
}

export function shouldApplySnapshotResponse(
  request: SnapshotRequestToken,
  latestSequence: number,
  desired: SnapshotTarget,
): boolean {
  return request.sequence === latestSequence && snapshotTargetsMatch(request, desired);
}
