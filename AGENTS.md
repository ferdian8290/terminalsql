# TerminalSQL - Agent Instructions & Architecture Guidelines

## Native Desktop App Paradigm
This project is treated as a **Native Desktop Application** (similar to VS Code, DBeaver, TablePlus, Warp, Termius).
When designing and developing interfaces, components, and interactions for this project:

1. **Native Context Menus Only (Never Browser Default)**:
   - Default browser context menus (`Back`, `Forward`, `Reload`, `Ask Gemini`, `Inspect`, `View Page Source`) must **NEVER** appear anywhere on the application UI.
   - All right-click actions (`onContextMenu`) must prevent default (`e.preventDefault()`) and display application-native, custom dark shadcn/ui-styled context menus with relevant actions (e.g. `Connect / Run`, `Edit Connection`, `Duplicate`, `Delete`, `Close Tab`, `Split Pane`, etc.).

2. **High-Density, Modern Enterprise Styling**:
   - Keep padding compact and proportioned (avoid huge vertical voids, excessive padding, or nested bulky card borders).
   - Sidebar connection items should be compact, with host/IP nested tightly right below the connection name.
   - Distinct brand icons for database engines (ClickHouse orange/yellow 4-bar logo, PostgreSQL blue PG logo, MySQL cyan MY, SQLite navy SQL).

3. **Interaction Standards**:
   - **Single Click (`onClick`)**: Selects / highlights the item without immediately opening or launching tabs.
   - **Double Click (`onDoubleClick`)**: Opens / runs the connection session (terminal, SQL query editor, or SFTP).
   - **Hover Action**: Displays quick-action button for Run only (no cluttering with delete/trash buttons on hover).
   - **Delete & Edit**: Accessible through the right-click custom context menu.
   - **Tabs Switcher**: In the left connection sidebar, categories (`Databases`, `Terminal`, `SFTP`) are organized into tabs with badges, placing the items underneath in their own dedicated, full-height scrollable canvas.
   - **Tab Closing**: When tabs in the workspace are closed, remaining tabs must immediately shift left seamlessly without leaving blank ghost spaces or animation voids.

4. **Strict High-Density Compact Typography & Sizing Standards (Mandatory)**:
   - **Zero Oversized Text**: Never use large browser defaults or puffy loose padding. All UI elements must stay ultra-compact enterprise grade.
   - **Global Scale Reference (`index.css`)**:
     - **Tree Items & Sidebar Elements**: Strictly compact `11px` (`text-[11px]` or `var(--font-size-xs)`), row height `h-5` (20px).
     - **Secondary / Metadata / Mono**: Strictly `9.5px` ~ `10px` (`text-[9.5px]` or `var(--font-size-2xs)`).
     - **Toolbar Buttons, Tabs, & Inputs**: Strictly `11.5px` ~ `12px` (`text-xs` or `var(--font-size-sm)`).
     - **Modal Titles & Group Headers**: Strictly `13px` ~ `14px` (`text-sm font-semibold`).
   - **Zero Duplicate Tooltips**: Inline hover metadata (e.g. `host:port`) must not be duplicated by floating popup tooltip cards.
5. **Zero-Reconnect Split Screen & Session Preservation**:
   - Tab layout changes (e.g. dragging tabs to split down/right) must NEVER terminate, close, or reconnect active SSH WebSocket sessions or database connections in the background.
   - All active terminal and editor DOM nodes must be preserved across React render lifecycles using the persistent session registry.

6. **Monaco SQL Editor Execution Standard**:
   - `Ctrl+Enter` (and `Cmd+Enter`) must always trigger query execution with priority given to highlighted/selected SQL text, falling back to the entire document.
   - Execution commands must be registered directly in Monaco via `editor.addCommand` and `editor.addAction`, complemented by capture-phase window keydown listeners.

7. **Mandatory Version Bumping & Automatic Git Push on Every Change**:
   - **Continuous Versioning**: Every time changes, enhancements, or bug fixes are made to the codebase, the agent MUST bump the semantic version (e.g. patch `x.y.Z` or minor `x.Y.0`) across all version locations:
     - Root `package.json`
     - `backend/package.json`
     - `frontend/package.json`
     - `backend/src/index.ts`
     - `frontend/src/version.ts`
     - `README.md` version badge
   - **Documentation Maintenance**: Always update `README.md` and/or `DOCKER_GUIDE.md` to document new features, scripts, or parameter changes.
   - **Build Verification**: Run `npm run build` locally to verify 0 errors before committing.
   - **Immediate Git Commit & Push**: Immediately stage all changes (`git add .`), create a structured conventional commit message, and push directly to GitHub (`git push origin main`). Never leave uncommitted changes or outdated remotes after completing a task.


