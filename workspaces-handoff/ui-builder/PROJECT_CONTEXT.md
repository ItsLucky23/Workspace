<!-- 
  to toggle markdown file press  
  1. ctrl + k
  2. v
-->


# UI-Builder Project Context

> **Human-readable documentation for AI assistants to understand this project.**  
> Last updated: 2025-01-11

---

## Project Overview

**UI-Builder** (internally called "LuckyStack") is a **creative platform** for:
- **Visual UI development** - Upload `.tsx/.jsx` files, compile with Babel, and render live in viewports
- **Idea organization** - Notes, drawings, and file management on an infinite 2D canvas
- **Future: Real-time collaboration** - Room-based sync infrastructure is built-in

The project is split into two logical parts:
1. **Framework** - Custom full-stack framework with authentication, sockets, and API routing
2. **Application (Sandbox)** - The main canvas-based workspace where users create

---

# Part 1: Framework Summary

The framework is a **custom-built React + Node.js stack** inspired by Next.js but with socket-first architecture.

## Root Configuration Files

| File | Purpose |
|------|---------|
| `config.ts` | Main app configuration (URLs, defaults, session layout). Gitignored - use `configTemplate.txt` |
| `envTemplate.txt` | Template for `.env` file with database, OAuth, and server secrets |
| `vite.config.ts` | Vite bundler config with path aliases (`src/`, `config`) and exclusions for server files |
| `index.html` | Entry point with two root divs: `#root` (app) and `#portalRoot` (modals/overlays z-999999999) |
| `redis.conf` | Redis configuration for session storage |
| `prisma/schema.prisma` | MongoDB database schema - currently only `user` model with OAuth providers |

## Server Architecture (`/server`)

The backend is **raw Node.js** (no Express) with a custom HTTP router and Socket.io.

### `server/server.ts` - Main Entry Point
- Creates HTTP server with CORS, security headers (Referrer-Policy, X-Frame-Options, X-XSS-Protection)
- HTTP route handling by path prefix:
  - `/auth/api/{provider}` → Redirects to OAuth provider or handles credentials login
  - `/auth/callback/{provider}` → Handles OAuth callback from providers
  - `/uploads/*` → Serves uploaded files (avatars, etc.)
  - `/assets/*` → Serves static assets
  - Everything else → Falls back to `index.html` for SPA routing
- In development mode: initializes hot-reload watchers and REPL console
- Initializes Socket.io via `loadSocket()`

### `server/auth/` - Authentication System

| File | Purpose |
|------|---------|
| `login.ts` | Handles credentials login/register and OAuth callback processing |
| `loginConfig.ts` | Defines 5 OAuth provider configs (credentials, Google, GitHub, Discord, Facebook) |
| `checkOrigin.ts` | Validates request origins against allowed domains (DNS, localhost, external origins) |

**Supported Providers:** credentials, Google, GitHub, Facebook, Discord

**Login Flow:**
1. Credentials: Validates email/password, hashes with bcrypt, creates/authenticates user
2. OAuth: Redirects to provider → callback exchanges code for token → fetches user info → creates/finds user
3. On successful login, generates random token and saves session to Redis

### `server/sockets/socket.ts` - Socket.io Server
Handles all real-time communication:
- **`apiRequest`** - RPC-style API calls from client (routed via `handleApiRequest.ts`)
- **`sync`** - Room-based sync events between clients (routed via `handleSyncRequest.ts`)
- **`joinRoom`** - Adds socket to a room (room code stored in session)
- **`updateLocation`** - Tracks user's current page path
- **`disconnect`** - Handles socket disconnection with optional activity broadcasting

### `server/sockets/handleApiRequest.ts` - API Request Handler
- Special handlers for `session` (returns user session) and `logout` (logs out user)
- Validates `auth` requirements before executing API functions
- **Auth Validation System** supports flexible conditions:
  - `login: true` - Requires user to be logged in
  - `additional: [{key, type?, value?, nullish?, mustBeFalsy?}]` - Custom field checks

### `server/sockets/handleSyncRequest.ts` - Sync Request Handler
- Validates server-side sync file before broadcasting
- Loops through all sockets in the room and runs client-side sync for each
- Supports `ignoreSelf` to exclude sender from receiving the event

### `server/functions/` - Server Utilities
| File | Purpose |
|------|---------|
| `session.ts` | Session CRUD in Redis + **auto-kicks previous sessions on login** |
| `redis.ts` | Redis client wrapper (ioredis) |
| `db.ts` | Prisma client export for MongoDB |
| `tryCatch.ts` | Error-safe async function wrapper |
| `sleep.ts` | Promise-based delay |
| `broadcaster.ts` | Utility for broadcasting to socket rooms |
| `game.ts` | Game-related utilities (for multiplayer games) |

### Session Kicking Feature (`session.ts`)
When a user logs in, the system automatically kicks all previous sessions for that user:
1. Looks up all active tokens for the user ID in Redis
2. For each existing session: emits `logout` event to connected sockets, deletes session data
3. Registers new token in the active users set
4. Broadcasts `updateSession` to all sockets with the new token

### `server/dev/` - Development Utilities
| File | Purpose |
|------|---------|
| `loader.ts` | Hot-reloads `_api` and `_sync` files without server restart |
| `hotReload.ts` | File watcher that triggers reloads on changes |

### `server/sockets/utils/` - Socket Utilities
| File | Purpose |
|------|---------|
| `logout.ts` | Handles logout: clears timers, leaves rooms, deletes session |
| `activityBroadcaster.ts` | Tracks user activity (AFK detection, reconnection) |

### Build Scripts (`/scripts`)
| Script | Purpose |
|--------|---------|
| `generateServerRequests.ts` | Scans `src/` for `_api/` and `_sync/` folders, generates route map |
| `bundleServer.ts` | Bundles server for production |
| `clearServerRequests.ts` | Clears generated route map for dev restart |

---

## Client Architecture (`/src`)

### Entry Point: `main.tsx`
- File-based routing similar to Next.js
- Scans for `page.tsx` in any non-underscore folder
- Wraps app in providers: `SocketStatus` → `Session` → `Translation` → `Avatar` → `MenuHandler` → `Router`

### Provider Hierarchy (Framework-level)
```
SocketStatusProvider   # Socket connection status
└── SessionProvider    # User session from Redis
    └── TranslationProvider  # i18n with JSON locale files
        └── AvatarProvider   # User avatar caching
            └── MenuHandlerProvider  # Global menu state
                └── RouterProvider   # React Router
```

### `src/_sockets/` - Client-Server Communication

These are the core functions for communicating with the backend:

#### `apiRequest({ name, data })` → Promise
- Sends RPC-style request over socket
- Auto-prefixes with current path: `api/{path}/{name}`
- Has abort controllers for duplicate GET-like requests

#### `syncRequest({ name, data, receiver, ignoreSelf })` → Promise  
- Sends real-time events to other clients in same room
- `receiver` is the room code (e.g., "abc123")
- `ignoreSelf` prevents the sender from receiving the event

#### `joinRoom(code)` → Promise
- Joins a socket room for sync events
- Room code stored in user session

### `src/_components/` - Reusable UI Components

| Component | Purpose |
|-----------|---------|
| `TemplateProvider.tsx` | Wraps pages in templates: `plain`, `main`, `sandbox` |
| `SessionProvider.tsx` | Provides session context and socket initialization |
| `Middleware.tsx` | Route authentication guards |
| `LoginForm.tsx` | OAuth login buttons |
| `MenuHandler.tsx` | Global menu/modal management |
| `Navbar.tsx` | Top navigation bar |
| `Tooltip.tsx` | Hover tooltips |
| `Dropdown.tsx` | Dropdown menus |
| `ConfirmMenu.tsx` | Confirmation dialogs |
| `TranslationProvider.tsx` | i18n with `src/_locales/{lang}.json` |

### Templates (`TemplateProvider.tsx`)

Pages export a `template` constant to specify their wrapper:

1. **`plain`** - Minimal wrapper, no UI chrome
2. **`main`** - Navbar with user info and navigation
3. **`sandbox`** - Full sandbox with all feature providers:
   ```
   GridProvider → BlueprintsProvider → BuilderPanelProvider → 
   MenusProvider → CodeProvider → DrawingProvider → NotesProvider → MainTemplate
   ```

### Page Routes

| Route | Template | Purpose |
|-------|----------|---------|
| `/` | plain | Root redirect based on session |
| `/login` | plain | OAuth login page |
| `/register` | plain | Registration (uses LoginForm) |
| `/home` | main | Sandbox selection (in progress) |
| `/settings` | main | User settings with `_api` folder |
| `/test` | main | Development testing with `_api` and `_sync` examples |
| `/sandbox` | sandbox | Main application canvas |

### API/Sync Convention

**API Routes** (server-only functions):
- Place files in `src/{page}/_api/{name}.ts`
- Export `main` function and optional `auth` guard
- Call from client: `apiRequest({ name: '{name}' })`

**Sync Routes** (real-time client-server events):
- `src/{page}/_sync/{name}_server.ts` - Runs on server for validation
- `src/{page}/_sync/{name}_client.ts` - Runs on receiving clients
- Call from client: `syncRequest({ name: '{name}', receiver: 'room-code' })`

---

## Styling

- **TailwindCSS v4** with custom colors in `src/index.css`
- Theme support: light (default) and dark mode via CSS classes
- Custom CSS variables for colors (`--color-background`, `--color-primary`, etc.)
- `src/NoteEditor.css` - ProseMirror/TipTap styles for notes
- `src/scrollbar-*.css` - Theme-specific scrollbar styles (not yet dynamically loaded)

---

# Part 2: Application Summary (Sandbox)

The sandbox is the **main application** - an infinite 2D canvas where users place and interact with various components.

## Sandbox Page (`src/sandbox/page.tsx`)

Split-panel layout:
- **Left Panel** - The infinite grid canvas
- **Right Panel** - Code editor (Monaco) for selected file
- **Divider** - Draggable to resize panels

## Sandbox Providers

Located in `src/sandbox/_providers/`:

| Provider | Purpose |
|----------|---------|
| `GridContextProvider` | Zoom, pan offset, dragging state, container ref |
| `BlueprintsContextProvider` | Central state for all grid items (files, notes, drawings) |
| `CodeContextProvider` | Currently selected code file and editor state |
| `DrawingContextProvider` | Drawing tool state (color, size, mode, strokes) |
| `NotesContextProvider` | Note editor state and selection |
| `MenusContextProvider` | Open/close state for sandbox menus |
| `BuilderPanelContextProvider` | Right panel visibility and divider position |

## Grid System (`src/sandbox/_components/grid/`)

### `Grid.tsx` - The Infinite Canvas
- Renders dot/line grid background that pans and zooms
- Contains all blueprint items (files, notes, drawings)
- Mouse handlers for pan, zoom, drag-drop
- Renders menus as overlays

**Grid Features:**
- Infinite panning with offset tracking
- Zoom with mousewheel (shows percentage indicator)
- Drag-and-drop file uploads
- Right-click context menu disabled
- **Scroll Mode Toggle:** Switch between zoom mode (scroll=zoom) and pan mode (scroll=up/down, shift+scroll=left/right, ctrl+scroll=zoom)
- **Center Button:** Smooth animated return to origin (0,0) at 100% zoom
- **Minimap:** Bottom-right overlay showing bird's-eye view with draggable viewport rectangle

### `ScreenRenderer.tsx`
- Renders Babel-compiled React components in viewports

### `ErrorBoundary.tsx`
- Catches rendering errors in child components

## Files System (`src/sandbox/_components/files/`)

### File Types
Any JavaScript-like file can be compiled with Babel:
- **`.tsx/.ts/.jsx/.js`** - Can be compiled with Babel and rendered live in viewports
- **Other files** - Displayed as file cards with preview

### View Modes
- **`code`** - Shows as a file card, opens in Monaco editor
- **`rendered`** - Compiles with Babel and displays in viewport frame

### `File.tsx`
- File card component on grid
- Click to select and open in editor
- Drag to move on grid

### `Render.tsx`  
- Renders compiled React component in a viewport frame
- Viewport sizes: Phone, Tablet, Laptop, Desktop, Large Desktop

## Code Editor (`src/sandbox/_components/editor/`)

### `Editor.tsx` - Main Editor Panel
- Renders in right panel when open
- Contains Monaco editor for the selected file

### `BaseCodeEditor.tsx` / `CodeEditor.tsx`
- Monaco editor wrapper with syntax highlighting
- Auto-detects language from file extension

### `CodeMirrorEditor.tsx`
- CodeMirror 6 editor for code blocks in notes
- Language-aware syntax highlighting

## Notes System (`src/sandbox/_components/notes/`)

### `Note.tsx`
- Note container on the grid
- Draggable and resizable
- Contains TipTap rich-text editor

### `NoteEditor.tsx`
- TipTap-based rich-text editor
- Supports: headings, lists, bold, italic, code blocks, task lists
- Uses `src/NoteEditor.css` for styling

### `CodeBlockComponent.tsx`
- Custom TipTap node for code blocks
- Embeds CodeMirror editor with language selection

### Note Options Menu
- Opened with `/` command in editor
- Options: headings, lists, code blocks, dividers, etc.

## Drawing System (`src/sandbox/_components/drawing/`)

### `DrawingLayer.tsx`
- SVG-based freehand drawing overlay
- Renders above grid items
- Uses `perfect-freehand` for smooth strokes

### Drawing Features
- Pen with variable stroke width
- Shapes: line, rectangle, circle, diamond
- Eraser with partial and complete erase modes
- Color picker
- Line styles: solid, dashed, dotted

### `DrawingSideMenu.tsx` / `DrawingTopMenu.tsx`
- Drawing tool selection and options
- Color, size, style controls

## Menus (`src/sandbox/_components/menus/`)

### `BottomLeftMenu.tsx`
- Quick access buttons (toggle drawing, etc.)

### `CreateComponentMenu.tsx`
- Right-click context menu
- Options to create files, notes, etc.

### `NoteOptionsMenu.tsx`
- Slash command menu in notes
- Insert headings, code blocks, lists, etc.

## Functions (`src/sandbox/_functions/`)

Organized by feature:

### `codeEditor/` - 23 files
- Babel compilation utilities
- Monaco editor configuration
- Language detection

### `drawing/` - 12 files
- Stroke point generation
- Shape algorithms
- Eraser logic

### `grid/` - 6 files
- `onMouseDown.ts` - Pan start, item selection
- `onMouseUp.ts` - Pan end, drop handling
- `onMouseMove.ts` - Pan motion, item dragging
- `onMouseWheel.ts` - Zoom handling
- `onFileDrop.ts` - File drag-and-drop upload

### `files/` - 2 files
- `babelUtils.ts` - File type detection, Babel compatibility
- `fileUtils.ts` - File reading, extension detection, MIME type handling

**File Upload Handling:**
When files are dropped onto the grid or uploaded via the context menu:
- **Text-based files** (code files like `.tsx`, `.ts`, `.jsx`, `.js`, `.json`, `.css`, `.html`, `.md`, etc.) are stored as **plain text content**
- **Binary files** (images, PDFs, ZIPs, etc.) are stored as **base64 encoded content**

The file type detection uses **extension-based priority**:
1. First checks if `getMonacoLanguage(extension)` returns a known language (not `'plaintext'`)
2. Falls back to browser MIME type via `getMimeTypeCategory(file.type)`
3. Code file extensions take priority - this handles cases where browsers don't provide proper MIME types for `.tsx`, `.ts`, etc.

**Key functions in `fileUtils.ts`:**
| Function | Purpose |
|----------|---------|
| `getFileExtension(fileName)` | Extracts lowercase extension from filename |
| `getMimeTypeCategory(mimeType)` | Categorizes MIME type: text, image, pdf, video, audio, binary |
| `getMonacoLanguage(extension)` | Maps file extension to Monaco editor language |
| `readFileAsText(file)` | Reads file as plain text string |
| `readFileAsBase64(file)` | Reads file as base64 string (without data URL prefix) |
| `getFileIcon(extension, mimeType)` | Returns FontAwesome icon for file type |
| `formatFileSize(bytes)` | Formats bytes as human-readable size |

### `notes/` - 3 files
- Note manipulation utilities

## Types (`src/sandbox/types/`)

| File | Purpose |
|------|---------|
| `blueprints.ts` | Shape definitions for files, notes, drawings |
| `gridProps.ts` | Grid-related type definitions |
| `viewportMapping.ts` | Viewport size presets |
| `NotesOptionsTypes.ts` | Note slash command options |
| `react*.d.ts` | React type augmentations for sandbox scope |

---

# Future Plans

Based on `ideas.md` and conversation history:

1. **Real-time collaboration** - Infrastructure exists (rooms, sync), needs UI implementation
2. **AI integration** - AI window that can interact with app functions
3. **Diagram builders** - Use case, flowchart, class, ERD diagrams
4. **User story tables** - Structured story format
5. **Requirements reports** - Checklist-based requirement validation
6. **File sync to profile** - Files saved across sandboxes
7. **Builder mode** - WordPress-like drag-drop UI editing
8. **Cross-file imports** - Import existing grid files into other files (e.g., import Dropdown component into another component). Saved files from user's profile would be added to grid for collaborator access.

> **Future Enhancement Ideas:**
> - Visual component tree for builder mode
> - Shared component library across sandboxes
> - Version history for files and notes
> - Export diagrams to PNG/SVG/PDF

---

# Quick Start for AI Assistants

## Understanding the codebase

1. **Root files** configure build, TypeScript, and Tailwind
2. **`/server`** is the custom Node.js backend with Socket.io
3. **`/src`** is the React frontend with file-based routing
4. **`/src/sandbox`** is the main application (canvas workspace)

## Common patterns

- **API calls**: `apiRequest({ name: 'functionName', data: {} })`
- **Real-time sync**: `syncRequest({ name: 'eventName', data: {}, receiver: 'roomCode' })`
- **State management**: Context providers, no Redux
- **Styling**: TailwindCSS with custom CSS variables

## Key provider access

```tsx
// Framework
const { session } = useSession();
const { t } = useTranslation();

// Sandbox
const { zoom, offset, containerRef } = useGrid();
const { blueprints, setBlueprints } = useBlueprints();
const { drawingState, setDrawingState } = useDrawing();
const { selectedFile, setSelectedFile } = useCode();
```

---

# File Tree Reference

```
UI-builder/
├── server/                   # Backend
│   ├── server.ts             # HTTP server entry
│   ├── sockets/              # Socket.io handlers
│   ├── auth/                 # OAuth providers
│   ├── functions/            # Server utilities
│   └── ...
├── src/                      # Frontend
│   ├── main.tsx              # App entry with routing
│   ├── page.tsx              # Root redirect
│   ├── index.css             # Global styles + Tailwind
│   ├── _components/          # Framework components
│   ├── _providers/           # Framework providers
│   ├── _sockets/             # Client-server communication
│   ├── _locales/             # i18n JSON files
│   ├── login/                # Login page
│   ├── home/                 # Home page
│   ├── settings/             # Settings with _api
│   ├── test/                 # Dev testing with _api, _sync
│   └── sandbox/              # Main application
│       ├── page.tsx          # Sandbox entry
│       ├── _providers/       # Sandbox state providers
│       ├── _components/      # Sandbox UI components
│       │   ├── grid/         # Canvas grid
│       │   ├── editor/       # Monaco code editor
│       │   ├── drawing/      # Freehand drawing
│       │   ├── notes/        # TipTap notes
│       │   ├── files/        # File cards
│       │   └── menus/        # Context menus
│       ├── _functions/       # Sandbox logic
│       └── types/            # TypeScript definitions
├── prisma/                   # Database schema
├── scripts/                  # Build scripts
└── config files...           # Vite, TypeScript, Tailwind
```

---

# Detailed Documentation

This section provides in-depth documentation for specific subsystems.

---

## Framework Components (`src/_components/`)

### MenuHandler.tsx - Global Modal System
A stack-based modal/menu system with slide animations.

**Key Features:**
- **Stack-based:** Modals stack on top of each other
- **Promise-based:** `open()` returns a Promise that resolves when closed
- **Slide animations:** Modals slide in from right, slide left when covered by another modal
- **Escape key:** Closes top modal
- **Background click:** Closes all modals

**API:**
```tsx
const { open, replace, close, closeAll } = useMenuHandler();

// Open a modal (returns Promise)
const result = await open(<MyModal />, { 
  dimBackground: true,  // Darken background
  background: 'bg-white',  // CSS class
  size: 'sm' | 'md' | 'lg'  // Width preset
});

// Replace current modal with new one
await replace(<NewModal />);

// Close top modal
close();

// Close entire stack
closeAll();
```

### Middleware.tsx - Route Guards
Wraps page content and validates access before rendering.

**Flow:**
1. Waits for session to load (max 5 seconds)
2. Calls `middlewareHandler()` with path, params, session
3. If `success: true` → renders children
4. If `redirect: '/path'` → navigates to path
5. If neither → navigates back

### middlewareHandler.ts - Route Access Rules
Switch statement defining per-route access rules.

```tsx
// Example rule structure
case '/admin':
  if (session?.admin) return { success: true };
  return { redirect: '/login' };
```

**Default:** All undefined routes are allowed.

### TranslationProvider.tsx - i18n System
Multi-language support with 4 languages: nl, en, de, fr.

**Features:**
- Reads language from user session
- Falls back to config.defaultLanguage
- Dynamic key lookup with dot notation
- Parameter replacement with `{{param}}`

**API:**
```tsx
const translations = useTranslation();
const setLanguage = useUpdateLanguage();

// Access translation
translations.login.title  // "Sign In"

// Dynamic translation with params
translate({ 
  translationList: translations,
  key: 'login.welcome',
  params: [{ key: 'name', value: 'John' }]
}); // "Welcome, John!"
```

---

## Framework Functions (`src/_functions/`)

| Function | Purpose |
|----------|---------|
| `notify.ts` | Toast notifications with i18n support (success, error, info, warning) |
| `confetti.ts` | Trigger confetti animation |
| `sleep.ts` | Promise-based delay utility |
| `tryCatch.ts` | Error-safe async function wrapper |
| `menuHandler.ts` | Menu state utilities |
| `middlewareHandler.ts` | Route access control logic |
| `translator.ts` | Get current language translations |
| `icon.ts` | Icon utilities |

---

## Sandbox Providers (`src/sandbox/_providers/`)

### BlueprintsContextProvider - Central Data Store
Stores all grid items: files, notes, drawings.

```tsx
type blueprints = {
  files: file[];      // Code files with positions
  notes: note[];      // Rich-text notes with positions
  drawings: drawing[]; // Freehand drawings
};

// Also supports "instances" - copies of blueprints
instances: blueprints[];  // For future component instancing
```

**Change-Based History (Undo/Redo):**
Uses operation-based history (not snapshots) to support future multiplayer sync.

| State | Type | Purpose |
|-------|------|---------|
| `localChanges` | GridChange[] | Stack of user's own operations |
| `changeIndex` | number | Current position in history (-1 = no changes) |
| `localBlueprints` | blueprints | Items created by this user |
| `remoteBlueprints` | blueprints | Items from other coop users (future) |
| `blueprints` | blueprints | Merged view (local + remote) for rendering |

**GridChange Type:**
```typescript
type GridChange = 
  | { type: 'create'; itemType: 'file' | 'note'; item: file | note }
  | { type: 'delete'; itemType: 'file' | 'note'; item: file | note };
// Future: | { type: 'move'; id: string; from: Position; to: Position }
```

**Actions:**
- `applyChange(change)`: Apply a create/delete operation (adds to history)
- `undoChange()`: Undo last change (async - may trigger ownership transfer)
- `redoChange()`: Redo next change
- `canUndo` / `canRedo`: Boolean helpers for UI

**Sync Event Hooks (for future coop):**
```typescript
setSyncCallbacks({
  // Called before undo-delete - return false to block and transfer ownership
  onBeforeDelete: (change) => {
    const isBeingEdited = checkIfOtherUserEditing(change.item.id);
    if (isBeingEdited) {
      // Move item to remoteBlueprints, notify other user they now own it
      return false; // Block the delete
    }
    return true;
  },
  
  // Called after any change - emit to sockets
  onChangeApplied: (change, direction) => {
    socket.emit('gridChange', { change, direction, userId: myId });
  },
  
  // Called when ownership transfers to another user
  onOwnershipTransfer: (itemId, newOwnerId) => {
    socket.emit('ownershipTransfer', { itemId, newOwnerId });
  }
});
```

**Ownership Transfer Pattern:**
When user A deletes a file but user B is editing it:
1. `onBeforeDelete` returns `false`
2. Item moves from `localBlueprints` to `remoteBlueprints`
3. Item removed from user A's history
4. Notification sent to user B who now owns it

**Keyboard Shortcuts:**
- Ctrl+Z: Undo (only when Monaco/TipTap/CodeMirror/Drawing not focused)
- Ctrl+Y: Redo

**UI:** Undo/Redo buttons in BottomLeftMenu.tsx


### GridContextProvider - Canvas State
Manages zoom, pan, and interaction refs.

| State | Type | Purpose |
|-------|------|---------|
| `zoom` | number | Current zoom level (0.1 - 10) |
| `offset` | {x, y} | Pan offset in pixels |
| `dragging` | boolean | Is user panning the grid |
| `containerRef` | Ref | Reference to grid container |
| `zoomRef` | Ref | Synced for event handlers |
| `scrollMode` | 'zoom' \| 'pan' | Mouse wheel behavior mode |
| `isTransitioning` | boolean | Controls smooth animation for center button |
| `resetToCenter()` | function | Animates view back to origin |

### DrawingContextProvider - Drawing State
Extensive state for the drawing system.

**Core State:**
- `strokes: StrokeData[]` - All completed strokes
- `currentPoints: DrawingPoint[]` - Currently drawing points
- `brushSize/brushColor` - Tool settings
- `lineStyle` - solid, dashed, dotted

**Modes:**
- `drawingEnabled` - Drawing mode active
- `erasing` - DISABLED, PARTIAL, or FULL erase mode
- `activeShape` - Current shape tool (square, circle, diamond, line, arrow)
- `selectionMode` - Selection tool active
- `fillMode` - Fill shapes with color
- `textMode` - Text tool (planned)

**Selection:**
- `selectedStrokeIds: string[]` - Currently selected strokes
- `marqueeMode/marqueeBox` - Marquee selection

**History:**
- `strokeHistory: StrokeData[][]` - Undo/redo stack
- `historyIndex: number` - Current position in history

### CodeContextProvider - Editor State
Manages Monaco editor instances.

| State | Purpose |
|-------|---------|
| `codeWindows` | All open code contexts |
| `activeCodeWindow` | Currently focused file ID |
| `codeWindowSize` | Font size (6-100) |
| `currentMonacoInstance` | Monaco module reference |
| `currentEditorInstance` | Active editor instance |

### NotesContextProvider - Note Editor State
Manages TipTap editor and slash menu.

| State | Purpose |
|-------|---------|
| `noteOptionsMenuOpen` | Slash menu visibility state |
| `noteOptionsMenuPosition` | Menu position (auto-clamped to viewport) |
| `lastActiveEditor` | TipTap editor + cursor position for focus restore |
| `wasNoteRecentlyActive` | Prevents unwanted focus loss |

---

## Drawing System Details

### Drawing Functions (`src/sandbox/_functions/drawing/`)

| File | Purpose |
|------|---------|
| `useDrawingEvents.ts` | Main drawing event handlers (33KB - core logic) |
| `generateShapePoints.ts` | Generates points for square, circle, diamond, line, arrow |
| `eraseStroke.ts` | Partial and full erase logic |
| `selectionUtils.ts` | Selection bounds calculation, hit testing |
| `snappingUtils.ts` | Alignment snapping (12KB - Figma-like behavior) |
| `clipUtils.ts` | Polygon clipping for partial erase |
| `exportUtils.ts` | Export drawings to PNG/SVG |
| `getSvgPathFromStroke.ts` | Convert stroke points to SVG path |
| `clientToWorld.ts` | Screen coordinates to world coordinates |
| `RenderDrawingPath.tsx` | React component to render stroke SVG |

### Stroke Data Structure
```tsx
type StrokeData = {
  id: string;
  points: DrawingPoint[];  // Array of {x, y, color, size}
  fill?: string;           // Fill color for shapes
  lineStyle?: 'solid' | 'dashed' | 'dotted';
};
```

### Erase Modes
- **PARTIAL:** Erases portions of strokes where brush touches (clips polygons)
- **FULL:** Removes entire stroke if any part is touched

---

## Code Editor System Details

### Code Editor Functions (`src/sandbox/_functions/codeEditor/`)

| Directory/File | Purpose |
|---------------|---------|
| `babel/` | Babel compilation for live preview |
| `autocompletions/` | Custom autocomplete providers |
| `tailwindcss/` | TailwindCSS autocomplete integration |
| `themes/` | Monaco editor color themes |
| `compilerOptions.ts` | TypeScript compiler configuration |
| `hoverTooltip.ts` | Custom hover tooltip logic |
| `traverseClickedComponent.ts` | Click-to-navigate for rendered components |

### Babel Compilation Flow
1. User edits `.tsx/.jsx` file in Monaco
2. **Breakpoint transformation**: `sm:`, `md:`, `lg:` classes are converted to container query variants (`@sm:`, `@md:`, `@lg:`) via `transformBreakpoints.ts`
3. Code is compiled with `@babel/standalone`
4. React component is extracted
5. Rendered in viewport with `@container` wrapper - responsive classes respond to viewport width, not browser window
6. Errors are caught and displayed in error boundary

**Per-Blueprint Responsive Breakpoints:**
Users can write standard Tailwind breakpoints (`md:bg-blue-500`) and they automatically work based on the blueprint's viewport size. The transformation converts viewport breakpoints to CSS container query variants before compilation.

| Breakpoint | Container Width | Example Use Case |
|------------|----------------|------------------|
| `sm:` → `@sm:` | ≥320px | Phone and up |
| `md:` → `@md:` | ≥448px | Tablet and up |
| `lg:` → `@lg:` | ≥512px | Laptop and up |
| `xl:` → `@xl:` | ≥576px | Desktop and up |

**Container Query Safelist:**
- `container-safelist.txt` contains all `@sm:`, `@md:`, `@lg:` variants (42k+ classes)
- Generated from `classes.js` by running: `node scripts/generateContainerSafelist.js`
- Regenerate this file if you add new classes to `classes.js`

### Viewport Sizes
```tsx
Viewports = {
  PHONE: { width: 375, height: 667 },
  TABLET: { width: 768, height: 1024 },
  LAPTOP: { width: 1366, height: 768 },
  DESKTOP: { width: 1920, height: 1080 },
  LARGE_DESKTOP: { width: 2560, height: 1440 }
}
```

---

## Notes System Details

### TipTap Extensions Used
- **StarterKit** - Basic formatting (bold, italic, headings, lists)
- **TaskList/TaskItem** - Checkbox task lists
- **Placeholder** - "Type / for commands" placeholder
- **CodeBlock (custom)** - Replaced with CodeMirror integration

### Slash Command Menu Options
Triggered by typing `/` in note editor:
- Heading 1, 2, 3
- Bullet List, Numbered List
- Task List (checkboxes)
- Code Block (opens CodeMirror)
- Divider
- Blockquote

### CodeBlock Integration
- Custom TipTap node wrapping CodeMirror 6
- Language selection dropdown
- Syntax highlighting per language
- Keyboard navigation refined (Escape to exit, Enter to focus)

---

# Code Examples & Patterns

This section provides real code examples from the codebase demonstrating common patterns.

---

## Creating an API Route

**File:** `src/{page}/_api/myApi.ts`

```typescript
import { AuthProps, SessionLayout } from 'config';
import { PrismaClient } from '@prisma/client';

// Define available server functions
interface Functions {
  prisma: PrismaClient;
  saveSession: (token: string, data: any) => Promise<boolean>;
  getSession: (token: string) => Promise<any | null>;
  deleteSession: (token: string) => Promise<boolean>;
  tryCatch: <T, P>(func: (values: P) => Promise<T> | T, params?: P) => Promise<[any, T | null]>;
  [key: string]: any;
}

interface ApiParams {
  data: Record<string, any>;  // Data sent from client
  functions: Functions;        // Server utilities
  user: SessionLayout;         // Current user session
}

// Auth guard - checks run before main()
export const auth: AuthProps = {
  login: true,  // Requires logged-in user
  additional: [
    // { key: 'admin', value: true },        // Must be admin
    // { key: 'email', type: 'string' },     // Email must be string
    // { key: 'groupId', mustBeFalsy: false }, // groupId must be truthy
    // { key: 'updatedAt', nullish: false }  // Must not be null/undefined
  ]
};

// Main API handler
export const main = async ({ data, functions, user }: ApiParams) => {
  const { prisma, tryCatch } = functions;
  
  // Example: fetch user's data
  const [error, result] = await tryCatch(async () => {
    return await prisma.user.findUnique({
      where: { id: user.id }
    });
  });
  
  if (error) {
    return { status: 'error', message: 'Database error' };
  }
  
  return { 
    status: 'success', 
    result: { userData: result } 
  };
};
```

**Calling from client:**
```tsx
import { apiRequest } from 'src/_sockets/apiRequest';

const response = await apiRequest({ 
  name: 'myApi',  // Matches filename without .ts
  data: { 
    someParam: 'value' 
  } 
});

console.log(response);  // { userData: {...} }
```

---

## Creating a Sync Event (Real-time)

Sync events require two files: `_server.ts` (validation) and `_client.ts` (per-user filtering).

### Server File: `src/{page}/_sync/updateData_server.ts`

```typescript
import { AuthProps, ServerSyncProps } from "config";

export const auth: AuthProps = {
  login: true,
  additional: []
};

// Runs ONCE when sync is called
// Can update database, validate data, etc.
export const main = async ({ clientData, user, functions }: ServerSyncProps) => {
  console.log('User triggered sync:', user.name);
  console.log('Client data:', clientData);
  
  // Example: update counter in Redis
  await functions.saveSession(`counter:${clientData.roomCode}`, {
    value: clientData.newValue
  });
  
  // Return data to be sent to all clients
  return {
    status: 'success',
    newValue: clientData.newValue,
    updatedBy: user.name
  };
};
```

### Client File: `src/{page}/_sync/updateData_client.ts`

```typescript
import { ClientSyncProps } from "config";

// Runs for EACH socket in the room
// Return status: 'success' to allow, or nothing/error to block
export const main = ({ user, serverData }: ClientSyncProps) => {
  // Example: only send to users on this specific page
  if (user?.location?.pathName !== '/sandbox') {
    return; // User won't receive the event
  }
  
  // Example: only send to non-admin users
  if (user?.admin) {
    return; // Admins won't receive
  }
  
  return {
    status: 'success',
    // Can add additional client-specific data
  };
};
```

### Triggering from Client:

```tsx
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';
import { joinRoom } from 'src/_sockets/socketInitializer';
import { useEffect } from 'react';

export default function MyPage() {
  // 1. Join a room on mount
  useEffect(() => {
    joinRoom('my-room-123');
  }, []);
  
  // 2. Register callback for receiving sync events
  const { upsertSyncEventCallback } = useSyncEvents();
  
  upsertSyncEventCallback('updateData', ({ serverData, clientData }) => {
    console.log('Received sync!', serverData);
    // Update UI with new data
    document.getElementById('counter')!.innerText = serverData.newValue;
  });
  
  // 3. Trigger sync to all users in room
  const handleClick = async () => {
    await syncRequest({
      name: 'updateData',
      data: { newValue: 42 },
      receiver: 'my-room-123',  // Room code
      ignoreSelf: false          // Set true to not receive your own event
    });
  };
  
  return <button onClick={handleClick}>Update All Clients</button>;
}
```

---

## Using the Notification System

```tsx
import notify from 'src/_functions/notify';

// Simple notifications (keys from _locales/*.json)
notify.success({ key: 'login.success' });
notify.error({ key: 'login.failed' });
notify.info({ key: 'common.loading' });
notify.warning({ key: 'common.unsavedChanges' });

// With parameters ({{param}} in translation string)
notify.success({ 
  key: 'welcome.greeting',  // "Welcome, {{name}}!"
  params: [
    { key: 'name', value: 'John' }
  ]
});
```

**Translation file example (`src/_locales/en.json`):**
```json
{
  "login": {
    "success": "Successfully logged in!",
    "failed": "Login failed. Please try again."
  },
  "welcome": {
    "greeting": "Welcome, {{name}}!"
  }
}
```

---

## Using the Modal System

### Basic Modal:
```tsx
import { useMenuHandler } from 'src/_components/MenuHandler';

function MyComponent() {
  const { open, close, closeAll } = useMenuHandler();
  
  const handleOpenModal = async () => {
    // open() returns a Promise that resolves when closed
    const result = await open(
      <div className="p-4 bg-white">
        <h2>My Modal</h2>
        <p>Modal content here</p>
        <button onClick={close}>Close</button>
      </div>,
      { 
        dimBackground: true,   // Dark overlay
        background: 'bg-white', // Modal background class
        size: 'md'              // 'sm' | 'md' | 'lg'
      }
    );
    
    console.log('Modal closed with:', result);
  };
  
  return <button onClick={handleOpenModal}>Open Modal</button>;
}
```

### Nested Modals (Stack):
```tsx
const { open, close } = useMenuHandler();

// First modal
open(
  <div className="p-4">
    <h2>First Modal</h2>
    <button onClick={() => {
      // Second modal slides in, first slides left
      open(
        <div className="p-4">
          <h2>Second Modal</h2>
          <button onClick={close}>Close (returns to first)</button>
        </div>,
        { background: 'bg-blue-100' }
      );
    }}>
      Open Nested
    </button>
  </div>,
  { background: 'bg-white' }
);
```

### Confirm Dialog:
```tsx
import { confirmDialog } from 'src/_components/ConfirmMenu';

const handleDelete = async () => {
  const confirmed = await confirmDialog({
    title: 'Delete Item',
    content: 'Are you sure you want to delete this item?',
    input: 'DELETE'  // Optional: require typing to confirm
  });
  
  if (confirmed) {
    // User confirmed
    await deleteItem();
  }
};
```

---

## Middleware Route Protection

**File:** `src/_functions/middlewareHandler.ts`

```typescript
import { SessionLayout } from "config";

export default function middlewareHandler({ 
  location, 
  searchParams, 
  session 
}: { 
  location: string, 
  searchParams: Record<string, any>, 
  session: SessionLayout | null 
}) {
  
  switch (location) {
    // Protected route - requires login
    case '/dashboard':
      if (session?.id) {
        return { success: true };
      }
      return { redirect: '/login' };
    
    // Admin only route
    case '/admin':
      if (session?.admin === true) {
        return { success: true };
      }
      return { redirect: '/unauthorized' };
    
    // Route with query param check
    case '/invite':
      if (searchParams.code) {
        return { success: true };
      }
      return { redirect: '/home' };
    
    // Public routes - allow all
    case '/login':
    case '/register':
    case '/about':
      return { success: true };
    
    // Default: allow (or change to require login)
    default:
      return { success: true };
  }
}
```

---

## Working with Blueprints (Grid Items)

```tsx
import { useBlueprints } from 'src/sandbox/_providers/BlueprintsContextProvider';

function MyComponent() {
  const { blueprints, setBlueprints } = useBlueprints();
  
  // Add a new file
  const addFile = () => {
    setBlueprints(prev => ({
      ...prev,
      files: [...prev.files, {
        id: crypto.randomUUID(),
        name: 'NewComponent.tsx',
        position: { x: 100, y: 100 },
        code: 'export default function NewComponent() { return <div>Hello</div>; }',
        viewMode: 'code',  // 'code' or 'rendered'
        viewport: { width: 375, height: 667, enabled: true }
      }]
    }));
  };
  
  // Add a new note
  const addNote = () => {
    setBlueprints(prev => ({
      ...prev,
      notes: [...prev.notes, {
        id: crypto.randomUUID(),
        position: { x: 200, y: 200 },
        width: 300,
        height: 200,
        content: JSON.stringify({
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'New note' }] }
          ]
        })
      }]
    }));
  };
  
  // Update a file's position
  const moveFile = (fileId: string, newX: number, newY: number) => {
    setBlueprints(prev => ({
      ...prev,
      files: prev.files.map(f => 
        f.id === fileId 
          ? { ...f, position: { x: newX, y: newY } }
          : f
      )
    }));
  };
  
  // Delete a note
  const deleteNote = (noteId: string) => {
    setBlueprints(prev => ({
      ...prev,
      notes: prev.notes.filter(n => n.id !== noteId)
    }));
  };
  
  return (
    <div>
      <button onClick={addFile}>Add File</button>
      <button onClick={addNote}>Add Note</button>
      <p>Files: {blueprints.files.length}</p>
      <p>Notes: {blueprints.notes.length}</p>
    </div>
  );
}
```

---

## Drawing System Usage

```tsx
import { useDrawing, ErasingMode } from 'src/sandbox/_providers/DrawingContextProvider';

function DrawingControls() {
  const {
    drawingEnabled,
    setDrawingEnabled,
    brushSize,
    setBrushSize,
    brushColor,
    updateBrushColor,
    erasing,
    setErasing,
    activeShape,
    setActiveShape,
    lineStyle,
    setLineStyle,
    strokes,
    strokeHistory,
    historyIndex,
    setHistoryIndex
  } = useDrawing();
  
  // Toggle drawing mode
  const toggleDrawing = () => setDrawingEnabled(!drawingEnabled);
  
  // Set eraser mode
  const enablePartialErase = () => setErasing(ErasingMode.PARTIAL);
  const enableFullErase = () => setErasing(ErasingMode.FULL);
  const disableErase = () => setErasing(ErasingMode.DISABLED);
  
  // Set shape tool
  const drawSquare = () => setActiveShape('square');
  const drawCircle = () => setActiveShape('circle');
  const freeDraw = () => setActiveShape(null);
  
  // Undo/Redo
  const undo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
    }
  };
  
  const redo = () => {
    if (historyIndex < strokeHistory.length - 1) {
      setHistoryIndex(historyIndex + 1);
    }
  };
  
  return (
    <div>
      <button onClick={toggleDrawing}>
        {drawingEnabled ? 'Exit Drawing' : 'Start Drawing'}
      </button>
      
      <input 
        type="color" 
        value={brushColor} 
        onChange={e => updateBrushColor(e.target.value)} 
      />
      
      <input 
        type="range" 
        min={1} max={50} 
        value={brushSize} 
        onChange={e => setBrushSize(Number(e.target.value))} 
      />
      
      <select 
        value={lineStyle} 
        onChange={e => setLineStyle(e.target.value as any)}
      >
        <option value="solid">Solid</option>
        <option value="dashed">Dashed</option>
        <option value="dotted">Dotted</option>
      </select>
      
      <button onClick={undo} disabled={historyIndex <= 0}>Undo</button>
      <button onClick={redo} disabled={historyIndex >= strokeHistory.length - 1}>Redo</button>
      
      <p>Strokes: {strokes.length}</p>
    </div>
  );
}
```

---

## File Structure Patterns

### Page with API and Sync:
```
src/
└── myFeature/
    ├── page.tsx           # Main page component
    ├── _api/              # Server-only API routes
    │   ├── getData.ts     # GET-like operations
    │   ├── saveData.ts    # POST-like operations
    │   └── deleteItem.ts  # DELETE operations
    └── _sync/             # Real-time sync events
        ├── itemUpdated_server.ts
        ├── itemUpdated_client.ts
        ├── userJoined_server.ts
        └── userJoined_client.ts
```

### Sandbox Feature:
```
src/sandbox/
├── _components/
│   └── myFeature/         # Feature UI components
│       ├── MyFeature.tsx
│       └── MyFeatureMenu.tsx
├── _functions/
│   └── myFeature/         # Feature logic
│       ├── utils.ts
│       └── handlers.ts
├── _providers/
│   └── MyFeatureContextProvider.tsx  # Feature state
└── types/
    └── myFeatureTypes.ts  # TypeScript types
```

---

## OAuth Login Flow

```tsx
import config from 'config';

// Redirect to OAuth provider
const loginWithGoogle = () => {
  window.location.href = `${config.backendUrl}/auth/api/google`;
};

const loginWithGithub = () => {
  window.location.href = `${config.backendUrl}/auth/api/github`;
};

// After OAuth callback, user is redirected to config.loginRedirectUrl
// with session cookie set automatically
```

---

## Session Access Patterns

```tsx
import { useSession, getCurrentSession } from 'src/_providers/SessionProvider';

// In a React component (hook)
function MyComponent() {
  const { session, sessionLoaded } = useSession();
  
  if (!sessionLoaded) {
    return <div>Loading...</div>;
  }
  
  if (!session?.id) {
    return <div>Please log in</div>;
  }
  
  return (
    <div>
      <p>Welcome, {session.name}!</p>
      <p>Email: {session.email}</p>
      <p>Theme: {session.theme}</p>
      <p>Language: {session.language}</p>
      <img src={session.avatar} alt="Avatar" />
    </div>
  );
}

// Outside React (in utility functions)
import { getCurrentSession } from 'src/_providers/SessionProvider';

function someUtilityFunction() {
  const session = getCurrentSession();
  if (session?.admin) {
    // Admin-only logic
  }
}
```

---

# Quick Reference Cheatsheet

> **Copy-paste ready snippets for common operations.**

---

## Imports

```tsx
// Sockets & Communication
import { apiRequest } from 'src/_sockets/apiRequest';
import { syncRequest, useSyncEvents } from 'src/_sockets/syncRequest';
import { joinRoom } from 'src/_sockets/socketInitializer';

// Session & Auth
import { useSession, getCurrentSession } from 'src/_providers/SessionProvider';

// UI Components
import { useMenuHandler } from 'src/_components/MenuHandler';
import { confirmDialog } from 'src/_components/ConfirmMenu';
import notify from 'src/_functions/notify';

// Translation
import { useTranslation, useUpdateLanguage, translate } from 'src/_components/TranslationProvider';

// Sandbox Providers
import { useGrid } from 'src/sandbox/_providers/GridContextProvider';
import { useBlueprints } from 'src/sandbox/_providers/BlueprintsContextProvider';
import { useDrawing, ErasingMode } from 'src/sandbox/_providers/DrawingContextProvider';
import { useCode } from 'src/sandbox/_providers/CodeContextProvider';
import { useNotes } from 'src/sandbox/_providers/NotesContextProvider';

// Config
import config from 'config';
```

---

## API Calls

| Action | Code |
|--------|------|
| Call API | `await apiRequest({ name: 'apiName', data: { key: 'value' } })` |
| Get session | `await apiRequest({ name: 'session' })` |
| Logout | `await apiRequest({ name: 'logout' })` |

---

## Real-time Sync

| Action | Code |
|--------|------|
| Join room | `joinRoom('room-code')` |
| Send sync | `await syncRequest({ name: 'eventName', data: {}, receiver: 'room-code' })` |
| Send (skip self) | `await syncRequest({ name: 'event', data: {}, receiver: 'room', ignoreSelf: true })` |
| Listen for sync | `useSyncEvents().upsertSyncEventCallback('eventName', ({ serverData }) => { ... })` |

---

## Notifications

| Type | Code |
|------|------|
| Success | `notify.success({ key: 'translation.key' })` |
| Error | `notify.error({ key: 'translation.key' })` |
| Info | `notify.info({ key: 'translation.key' })` |
| Warning | `notify.warning({ key: 'translation.key' })` |
| With params | `notify.success({ key: 'key', params: [{ key: 'name', value: 'John' }] })` |

---

## Modal System

| Action | Code |
|--------|------|
| Open modal | `menuHandler.open(<Component />, { dimBackground: true, size: 'md' })` |
| Close top | `menuHandler.close()` |
| Close all | `menuHandler.closeAll()` |
| Confirm dialog | `const ok = await confirmDialog({ title: 'Delete?', content: 'Are you sure?' })` |
| Confirm + input | `await confirmDialog({ title: 'Type YES', input: 'YES' })` |

---

## Session

| Action | Code |
|--------|------|
| Get in component | `const { session, sessionLoaded } = useSession()` |
| Get outside React | `const session = getCurrentSession()` |
| Check logged in | `if (session?.id) { ... }` |
| Check admin | `if (session?.admin) { ... }` |

---

## Blueprints (Grid Items)

| Action | Code |
|--------|------|
| Get blueprints | `const { blueprints, setBlueprints } = useBlueprints()` |
| Add file | `setBlueprints(p => ({ ...p, files: [...p.files, newFile] }))` |
| Add note | `setBlueprints(p => ({ ...p, notes: [...p.notes, newNote] }))` |
| Update file | `setBlueprints(p => ({ ...p, files: p.files.map(f => f.id === id ? {...f, ...changes} : f) }))` |
| Delete file | `setBlueprints(p => ({ ...p, files: p.files.filter(f => f.id !== id) }))` |

---

## Drawing

| Action | Code |
|--------|------|
| Toggle drawing | `setDrawingEnabled(!drawingEnabled)` |
| Set color | `updateBrushColor('#FF0000')` |
| Set size | `setBrushSize(20)` |
| Partial erase | `setErasing(ErasingMode.PARTIAL)` |
| Full erase | `setErasing(ErasingMode.FULL)` |
| Stop erasing | `setErasing(ErasingMode.DISABLED)` |
| Draw square | `setActiveShape('square')` |
| Draw circle | `setActiveShape('circle')` |
| Freehand | `setActiveShape(null)` |
| Undo | `setHistoryIndex(historyIndex - 1)` |
| Redo | `setHistoryIndex(historyIndex + 1)` |

---

## Grid

| Action | Code |
|--------|------|
| Get grid state | `const { zoom, offset, setZoom, setOffset } = useGrid()` |
| Reset zoom | `setZoom(1)` |
| Reset position | `setOffset({ x: 0, y: 0 })` |

---

## Translation

| Action | Code |
|--------|------|
| Get translations | `const t = useTranslation()` |
| Access key | `t.login.title` |
| Change language | `const setLang = useUpdateLanguage(); setLang('en')` |
| Dynamic translate | `translate({ translationList: t, key: 'key', params: [...] })` |

---

## File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| Page | `src/{route}/page.tsx` | `src/dashboard/page.tsx` |
| API | `src/{route}/_api/{name}.ts` | `src/settings/_api/updateProfile.ts` |
| Sync Server | `src/{route}/_sync/{name}_server.ts` | `src/game/_sync/move_server.ts` |
| Sync Client | `src/{route}/_sync/{name}_client.ts` | `src/game/_sync/move_client.ts` |
| Provider | `src/sandbox/_providers/{Name}ContextProvider.tsx` | `DrawingContextProvider.tsx` |
| Component | `src/sandbox/_components/{feature}/{Name}.tsx` | `drawing/DrawingSideMenu.tsx` |

---

## Auth Guard Options

```typescript
export const auth: AuthProps = {
  login: true,                              // Must be logged in
  additional: [
    { key: 'admin', value: true },          // admin === true
    { key: 'email', type: 'string' },       // typeof email === 'string'
    { key: 'groupId', mustBeFalsy: false }, // groupId is truthy
    { key: 'deletedAt', nullish: true },    // deletedAt is null/undefined
  ]
};
```

---

## Config Keys (`config.ts`)

| Key | Purpose |
|-----|---------|
| `backendUrl` | Server URL for API/socket |
| `devMode` | Development mode flag |
| `defaultLanguage` | Fallback language ('en') |
| `defaultTheme` | Fallback theme ('light') |
| `loginRedirectUrl` | Where to go after login |
| `loginPageUrl` | Login page path |
| `providers` | Enabled OAuth providers array |

---

## Keyboard Shortcuts (Sandbox)

| Shortcut | Action |
|----------|--------|
| `Escape` | Exit drawing mode / Close menu / Deselect |
| `Ctrl+Z` | Undo (when implemented) |
| `Ctrl+Shift+Z` | Redo (when implemented) |
| `/` | Open slash command menu in notes |
| `Enter` | Focus code block in notes |

---

## Common Type Shapes

```typescript
// File on grid
type file = {
  id: string;
  name: string;
  position: { x: number; y: number };
  code: string;
  viewMode: 'code' | 'rendered';
  viewport: { width: number; height: number; enabled: boolean };
};

// Note on grid
type note = {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  content: string; // TipTap JSON stringified
};

// Drawing stroke
type StrokeData = {
  id: string;
  points: { x: number; y: number; color: string; size: number }[];
  fill?: string;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
};

// Session
type SessionLayout = {
  id: string;
  name: string;
  email: string;
  provider: string;
  avatar: string;
  admin: boolean;
  language: string;
  theme: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
};
```
