//? FontAwesome icon barrel for the Workspaces prototype.
//?
//? The prototype's `_components/Icon.tsx` maps kebab icon names to FontAwesome
//? icon objects and imports both the React component and the `fa*` objects from
//? here. It lives at `src/_functions/icon` (outside `src/workspaces/`) because
//? the prototype references it by that absolute path — see the PORT_MANIFEST
//? self-containment note. Re-exports the React component + the free solid set.

export { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
export * from '@fortawesome/free-solid-svg-icons';
