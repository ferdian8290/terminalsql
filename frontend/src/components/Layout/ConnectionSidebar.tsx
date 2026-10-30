import { useState, useEffect, useMemo } from 'react';
import {
  Terminal, Database, FolderOpen, Plus, Search,
  Trash2, Server, ChevronLeft, ChevronRight, ArrowUpDown,
  Edit3, Copy, Play, Folder, FolderPlus, ChevronDown, FolderInput,
  CornerDownRight, Check, RefreshCw, ChevronsUpDown, FolderX, Loader2,
  Key, Columns, MoreHorizontal, PowerOff
} from 'lucide-react';
import {
  DbCylinderIcon,
  SchemaTableIcon,
  SchemaForeignTableIcon,
  SchemaViewIcon,
  SchemaMatViewIcon,
  SchemaFolderBranchIcon,
} from '@/components/common/SchemaIcons';
import { useAppStore, Connection } from '@/store/appStore';
import { api } from '@/utils/api';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { ImportExportModal } from '../ConnectionManager/ImportExportModal';
import { NewConnectionModal } from '../ConnectionManager/NewConnectionModal';

interface Props {
  onNewConnection: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  width?: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  conn: Connection;
}

interface FolderContextMenuState {
  x: number;
  y: number;
  folderName: string;
}

interface CanvasContextMenuState {
  x: number;
  y: number;
}

import { getDatabaseBrandIcon as getDatabaseIcon } from '@/components/common/DatabaseBrandIcons';

export function ConnectionSidebar({ onNewConnection, collapsed, onToggleCollapse, width }: Props) {
  const { connections, removeConnection, addConnection, updateConnection, setConnections, openTab, tabs, setActiveTab, closeTab, activeTabId, tabStatuses } = useAppStore();
  const [search, setSearch] = useState('');
  const [showImportExport, setShowImportExport] = useState(false);

  // Persist last selected sidebar category in localStorage
  const [activeCategory, setActiveCategoryState] = useState<'database' | 'ssh' | 'sftp'>(() => {
    try {
      const saved = localStorage.getItem('terminalsql_sidebar_category') as 'database' | 'ssh' | 'sftp' | null;
      if (saved && ['database', 'ssh', 'sftp'].includes(saved)) return saved;
    } catch {}
    return 'database';
  });

  const setActiveCategory = (cat: 'database' | 'ssh' | 'sftp') => {
    setActiveCategoryState(cat);
    try {
      localStorage.setItem('terminalsql_sidebar_category', cat);
    } catch {}
  };

  // Automatically sync sidebar category to match currently active workspace session
  useEffect(() => {
    if (!activeTabId) return;
    const currentTab = tabs.find((t) => t.id === activeTabId);
    if (currentTab) {
      const targetCategory = currentTab.type === 'ssh' ? 'ssh' : currentTab.type === 'database' ? 'database' : 'sftp';
      setActiveCategory(targetCategory);
    }
  }, [activeTabId, tabs]);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<CanvasContextMenuState | null>(null);
  const [editingConn, setEditingConn] = useState<Connection | null>(null);
  const [newConnInitialFolder, setNewConnInitialFolder] = useState<string | undefined>(undefined);

  // Database tree expansion state
  const [expandedConnTree, setExpandedConnTree] = useState<Record<string, boolean>>({});
  const [connSchemas, setConnSchemas] = useState<Record<string, { loading: boolean; databases?: any[]; schema?: Record<string, any[]>; error?: string }>>({});
  const [expandedDbNodes, setExpandedDbNodes] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [tableContextMenu, setTableContextMenu] = useState<{
    x: number;
    y: number;
    conn: Connection;
    dbName: string;
    tableName: string;
  } | null>(null);

  // Drag and drop states
  const [draggingConnId, setDraggingConnId] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [dragOverRoot, setDragOverRoot] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Folder states scoped per tab category: 'database' | 'ssh' | 'sftp'
  const [categoryFolders, setCategoryFolders] = useState<Record<'database' | 'ssh' | 'sftp', string[]>>(() => {
    const saved = localStorage.getItem('terminalsql_category_folders');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return { database: [], ssh: [], sftp: [] };
  });

  const updateCategoryFolders = (
    updater: (prev: Record<'database' | 'ssh' | 'sftp', string[]>) => Record<'database' | 'ssh' | 'sftp', string[]>
  ) => {
    setCategoryFolders((prev) => {
      const next = updater(prev);
      localStorage.setItem('terminalsql_category_folders', JSON.stringify(next));
      return next;
    });
  };

  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [folderDialog, setFolderDialog] = useState<{ open: boolean; folderName: string; isRename?: boolean; oldName?: string } | null>(null);
  const [moveDialog, setMoveDialog] = useState<{ open: boolean; conn: Connection } | null>(null);

  async function toggleConnTree(conn: Connection, e?: React.MouseEvent) {
    if (e) e.stopPropagation();
    const willOpen = !expandedConnTree[conn.id];
    setExpandedConnTree((prev) => ({ ...prev, [conn.id]: willOpen }));

    if (willOpen && (!connSchemas[conn.id] || (!connSchemas[conn.id].databases && !connSchemas[conn.id].loading))) {
      setConnSchemas((prev) => ({ ...prev, [conn.id]: { loading: true, error: undefined } }));
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timed out')), 12000)
        );
        const res: any = await Promise.race([api.database.schema(conn.id), timeoutPromise]);
        const dbs = res.databases && res.databases.length > 0
          ? res.databases
          : [{ name: (conn as any).database || 'public', tables: (res.tables || []).map((t: any) => ({ name: t.tableName || t.name })) }];
        setConnSchemas((prev) => ({ ...prev, [conn.id]: { loading: false, databases: dbs, schema: res.schema } }));
        if (dbs[0]) {
          setExpandedDbNodes((prev) => ({
            ...prev,
            [`${conn.id}:${dbs[0].name}`]: true,
            [`${conn.id}:${dbs[0].name}:tables`]: true,
          }));
        }
      } catch (err: any) {
        setConnSchemas((prev) => ({ ...prev, [conn.id]: { loading: false, error: err.message || 'Failed to load' } }));
        toast.error('Failed to load schema: ' + (err.message || 'Error'));
      }
    }
  }

  function buildTableQuery(
    conn: Connection,
    dbName: string | undefined,
    tableName: string,
    mode: 'select' | 'count' = 'select'
  ): string {
    const dbType =
      (conn as any).dbType?.toLowerCase() ||
      (conn.port === 5432 || conn.port === 6432 || conn.port === 8000
        ? 'postgres'
        : conn.port === 8123 || conn.port === 9443 || conn.port === 21426
        ? 'clickhouse'
        : conn.port === 3306
        ? 'mysql'
        : 'postgres');

    const isCount = mode === 'count';

    if (dbType === 'postgres') {
      let tableRef = `"${tableName}"`;
      if (dbName && dbName !== 'default' && dbName !== conn.name && dbName !== 'quality') {
        tableRef = `"${dbName}"."${tableName}"`;
      }
      return isCount
        ? `SELECT count(*) AS total_rows FROM ${tableRef};\n`
        : `SELECT * FROM ${tableRef} LIMIT 100;\n`;
    }

    if (dbType === 'clickhouse') {
      let tableRef = `\`${tableName}\``;
      if (dbName && dbName !== 'default') {
        tableRef = `\`${dbName}\`.\`${tableName}\``;
      }
      return isCount
        ? `SELECT count() AS total_rows FROM ${tableRef};\n`
        : `SELECT * FROM ${tableRef} LIMIT 100;\n`;
    }

    if (dbType === 'mysql') {
      let tableRef = `\`${tableName}\``;
      if (dbName && dbName !== 'default') {
        tableRef = `\`${dbName}\`.\`${tableName}\``;
      }
      return isCount
        ? `SELECT count(*) AS total_rows FROM ${tableRef};\n`
        : `SELECT * FROM ${tableRef} LIMIT 100;\n`;
    }

    // SQLite / fallback
    return isCount
      ? `SELECT count(*) AS total_rows FROM "${tableName}";\n`
      : `SELECT * FROM "${tableName}" LIMIT 100;\n`;
  }

  function handleOpenTableQuery(
    conn: Connection,
    dbName: string,
    tableName: string,
    mode: 'select' | 'count' = 'select'
  ) {
    const newQuery = buildTableQuery(conn, dbName, tableName, mode);
    const existingTab = tabs.find((t) => t.connectionId === conn.id && t.type === 'database');

    if (existingTab) {
      setActiveTab(existingTab.id);
      window.dispatchEvent(
        new CustomEvent('terminalsql:append-query', {
          detail: { tabId: existingTab.id, newQuery, dbName, runImmediately: false },
        })
      );
    } else {
      openTab({
        type: 'database',
        label: `SQL: ${conn.name}`,
        connectionId: conn.id,
        connection: conn,
        initialQuery: newQuery,
        initialDatabase: dbName,
      });
    }
    if (window.innerWidth < 768 && onToggleCollapse) {
      onToggleCollapse();
    }
  }

  function handleDisconnect(conn: Connection) {
    const connTabs = tabs.filter((t) => t.connectionId === conn.id);
    if (connTabs.length > 0) {
      connTabs.forEach((t) => closeTab(t.id));
      toast.success(`Disconnected: ${conn.name}`);
    } else {
      toast(`No active session for ${conn.name}`);
    }
    if (expandedConnTree[conn.id]) {
      setExpandedConnTree((prev) => ({ ...prev, [conn.id]: false }));
    }
  }

  const filterText = search.toLowerCase().trim();
  const filtered = useMemo(() =>
    filterText
      ? connections.filter(
          (c) =>
            c.name.toLowerCase().includes(filterText) ||
            c.host.toLowerCase().includes(filterText) ||
            c.username.toLowerCase().includes(filterText) ||
            (c.folder && c.folder.toLowerCase().includes(filterText))
        )
      : connections,
    [connections, filterText]
  );

  const sshConns = useMemo(() => filtered.filter((c) => c.type === 'ssh'), [filtered]);
  const dbConns = useMemo(() => filtered.filter((c) => c.type === 'database'), [filtered]);
  const sftpConns = useMemo(
    () => filtered.filter((c) => c.type === 'sftp'),
    [filtered]
  );

  const currentCategoryConns = useMemo(() =>
    activeCategory === 'database' ? dbConns : activeCategory === 'ssh' ? sshConns : sftpConns,
    [activeCategory, dbConns, sshConns, sftpConns]
  );

  // Extract all distinct folders for current active category only
  const activeFolders = useMemo(() =>
    Array.from(
      new Set([
        ...(categoryFolders[activeCategory] || []),
        ...currentCategoryConns.map((c) => c.folder).filter(Boolean) as string[],
      ])
    ).sort(),
    [categoryFolders, activeCategory, currentCategoryConns]
  );

  function toggleFolder(folder: string) {
    setExpandedFolders((prev) => ({
      ...prev,
      [folder]: prev[folder] !== undefined ? !prev[folder] : false, // Default is expanded (undefined is true)
    }));
  }

  function isFolderOpen(folder: string) {
    return expandedFolders[folder] !== false; // Default true
  }

  function handleOpenTerminal(conn: Connection, e?: React.MouseEvent) {
    e?.stopPropagation();
    const existingTab = tabs.find((t) => t.connectionId === conn.id && t.type === 'ssh');
    if (existingTab) {
      setActiveTab(existingTab.id);
    } else {
      openTab({
        type: 'ssh',
        label: conn.name,
        connectionId: conn.id,
        connection: conn,
      });
    }
    if (window.innerWidth < 768 && onToggleCollapse) {
      onToggleCollapse();
    }
  }

  function handleOpenSFTP(conn: Connection, e?: React.MouseEvent) {
    e?.stopPropagation();
    const existingTab = tabs.find((t) => t.connectionId === conn.id && t.type === 'sftp');
    if (existingTab) {
      setActiveTab(existingTab.id);
    } else {
      openTab({
        type: 'sftp',
        label: `SFTP: ${conn.name}`,
        connectionId: conn.id,
        connection: conn,
      });
    }
    if (window.innerWidth < 768 && onToggleCollapse) {
      onToggleCollapse();
    }
  }

  function handleOpenDatabase(conn: Connection, e?: React.MouseEvent) {
    e?.stopPropagation();
    const existingTab = tabs.find((t) => t.connectionId === conn.id && t.type === 'database');
    if (existingTab) {
      setActiveTab(existingTab.id);
    } else {
      openTab({
        type: 'database',
        label: `SQL: ${conn.name}`,
        connectionId: conn.id,
        connection: conn,
        initialQuery: '',
        initialDatabase: (conn as any).database || undefined,
      });
    }
    if (window.innerWidth < 768 && onToggleCollapse) {
      onToggleCollapse();
    }
  }

  async function handleDelete(conn: Connection, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!confirm(`Delete connection "${conn.name}"?`)) return;
    try {
      await api.connections.delete(conn.id);
      removeConnection(conn.id);
      toast.success('Connection deleted');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  async function handleDuplicate(conn: Connection) {
    try {
      const full: any = await api.connections.get(conn.id);
      const res: any = await api.connections.create({
        name: `${conn.name} (Copy)`,
        type: conn.type,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        folder: conn.folder || null,
        credentials: full.connection?.credentials || {},
        tags: conn.tags || [],
        color: conn.color,
      });
      addConnection(res.connection);
      toast.success(`Duplicated "${conn.name}"`);
    } catch (err: any) {
      toast.error('Failed to duplicate: ' + err.message);
    }
  }

  async function handleMoveConnection(conn: Connection, targetFolder: string | null) {
    try {
      const res: any = await api.connections.update(conn.id, { folder: targetFolder });
      if (res.connection) {
        updateConnection(res.connection);
      } else {
        updateConnection({ ...conn, folder: targetFolder });
      }
      toast.success(targetFolder ? `Moved to "${targetFolder}"` : 'Moved to root');
    } catch (err: any) {
      toast.error('Failed to move: ' + err.message);
    } finally {
      setMoveDialog(null);
    }
  }

  async function handleSaveFolder() {
    if (!folderDialog || !folderDialog.folderName.trim()) return;
    const name = folderDialog.folderName.trim();

    if (folderDialog.isRename && folderDialog.oldName) {
      const oldName = folderDialog.oldName;
      // Update all connections in this folder for current category
      const connsInFolder = currentCategoryConns.filter((c) => c.folder === oldName);
      for (const c of connsInFolder) {
        await api.connections.update(c.id, { folder: name }).catch(() => {});
        updateConnection({ ...c, folder: name });
      }
      updateCategoryFolders((prev) => ({
        ...prev,
        [activeCategory]: (prev[activeCategory] || []).map((f) => (f === oldName ? name : f)),
      }));
      toast.success(`Folder renamed to "${name}"`);
    } else {
      updateCategoryFolders((prev) => {
        const list = prev[activeCategory] || [];
        if (!list.includes(name)) {
          return { ...prev, [activeCategory]: [...list, name] };
        }
        return prev;
      });
      setExpandedFolders((prev) => ({ ...prev, [name]: true }));
      toast.success(`Folder "${name}" created in ${activeCategory === 'database' ? 'Databases' : activeCategory === 'ssh' ? 'Terminal' : 'SFTP'}`);
    }
    setFolderDialog(null);
  }

  async function handleDeleteFolder(folderName: string) {
    if (!confirm(`Delete folder "${folderName}"? (Connections inside will be moved to root)`)) return;
    const connsInFolder = currentCategoryConns.filter((c) => c.folder === folderName);
    for (const c of connsInFolder) {
      await api.connections.update(c.id, { folder: null }).catch(() => {});
      updateConnection({ ...c, folder: null });
    }
    updateCategoryFolders((prev) => ({
      ...prev,
      [activeCategory]: (prev[activeCategory] || []).filter((f) => f !== folderName),
    }));
    toast.success(`Folder "${folderName}" deleted`);
  }

  async function handleDeleteFolderAndConns(folderName: string) {
    const connsInFolder = currentCategoryConns.filter((c) => c.folder === folderName);
    if (!confirm(`Delete folder "${folderName}" AND all ${connsInFolder.length} connections inside it?`)) return;
    for (const c of connsInFolder) {
      await api.connections.delete(c.id).catch(() => {});
      removeConnection(c.id);
    }
    updateCategoryFolders((prev) => ({
      ...prev,
      [activeCategory]: (prev[activeCategory] || []).filter((f) => f !== folderName),
    }));
    toast.success(`Folder "${folderName}" and connections deleted`);
  }

  function handleExpandAllFolders() {
    const all: Record<string, boolean> = {};
    activeFolders.forEach((f) => {
      all[f] = true;
    });
    setExpandedFolders(all);
    toast.success('All folders expanded');
  }

  function handleCollapseAllFolders() {
    const all: Record<string, boolean> = {};
    activeFolders.forEach((f) => {
      all[f] = false;
    });
    setExpandedFolders(all);
    toast.success('All folders collapsed');
  }

  async function handleRefreshConnections() {
    setIsRefreshing(true);
    try {
      const res = await api.connections.list();
      setConnections(res.connections);
      toast.success('Connections refreshed');
    } catch (err: any) {
      toast.error('Failed to refresh: ' + err.message);
    } finally {
      setIsRefreshing(false);
    }
  }

  function renderConnectionItem(conn: Connection, isInsideFolder = false) {
    const isDb = conn.type === 'database';
    const isSsh = conn.type === 'ssh';
    const isSelected = selectedConnId === conn.id;
    const hasTab = tabs.some((t) => t.connectionId === conn.id);
    const isConnected = isSsh
      ? tabs.some((t) => t.connectionId === conn.id && tabStatuses[t.id] === 'connected')
      : isDb
        ? hasTab
        : tabs.some((t) => t.connectionId === conn.id && tabStatuses[t.id] === 'connected');
    const isTreeExpanded = Boolean(expandedConnTree[conn.id]);
    const isDragging = draggingConnId === conn.id;

    return (
      <div key={conn.id} className="space-y-0.5">
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', conn.id);
            e.dataTransfer.effectAllowed = 'move';
            setDraggingConnId(conn.id);
          }}
          onDragEnd={() => {
            setDraggingConnId(null);
            setDragOverFolder(null);
            setDragOverRoot(false);
          }}
          onClick={(e) => {
            e.stopPropagation();
            const wasSelected = selectedConnId === conn.id;
            setSelectedConnId(conn.id);
            if (isDb && isConnected && wasSelected) {
              toggleConnTree(conn, e);
            }
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (activeCategory === 'sftp') {
              handleOpenSFTP(conn);
            } else if (isSsh) {
              handleOpenTerminal(conn);
            } else if (isDb) {
              if (isConnected) {
                const existingTab = tabs.find((t) => t.connectionId === conn.id && t.type === 'database');
                if (existingTab) {
                  setActiveTab(existingTab.id);
                }
                toggleConnTree(conn, e);
              } else {
                handleOpenDatabase(conn);
                if (!expandedConnTree[conn.id]) {
                  toggleConnTree(conn, e);
                }
              }
            } else {
              handleOpenSFTP(conn);
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSelectedConnId(conn.id);
            setFolderContextMenu(null);
            setCanvasContextMenu(null);
            setTableContextMenu(null);
            setContextMenu({
              x: Math.min(e.clientX, window.innerWidth - 190),
              y: Math.min(e.clientY, window.innerHeight - 230),
              conn,
            });
          }}
          className={`group relative flex items-center justify-between h-7 px-1.5 rounded cursor-pointer transition-all ${
            isDragging ? 'opacity-40 border border-dashed border-purple-500' : ''
          } ${
            isSelected
              ? 'bg-accent text-accent-foreground ring-1 ring-border shadow-sm'
              : 'hover:bg-muted text-foreground/90 hover:text-foreground border border-transparent'
          }`}
        >
          {/* Left: Chevron (for DB) + Icon + Name */}
          <div className="flex items-center gap-1.5 min-w-0 pr-1 flex-1">
            {isDb && (
              <button
                type="button"
                onClick={(e) => toggleConnTree(conn, e)}
                className="w-3.5 h-3.5 flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0 -ml-0.5"
                title={isTreeExpanded ? 'Collapse' : 'Expand'}
              >
                <ChevronRight
                  className={`w-2.5 h-2.5 transition-transform ${
                    isTreeExpanded ? 'rotate-90 text-foreground' : ''
                  }`}
                />
              </button>
            )}

            <div className="shrink-0 flex items-center justify-center">
              {activeCategory === 'sftp' ? (
                <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${isConnected ? 'text-amber-400' : 'text-amber-400/80'}`} />
              ) : isDb ? (
                getDatabaseIcon(conn)
              ) : (
                <Terminal className={`w-3.5 h-3.5 shrink-0 ${isConnected ? 'text-emerald-400' : 'text-zinc-400'}`} />
              )}
            </div>

            <TooltipProvider delayDuration={350}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[11px] font-medium truncate leading-none cursor-pointer">
                    {conn.name}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="font-mono text-[10px] py-0.5 px-2">
                  <p>{conn.username ? `${conn.username}@` : ''}{conn.host}{conn.port ? `:${conn.port}` : ''}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            {isConnected && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 shadow-[0_0_6px_rgba(52,211,153,0.8)] animate-pulse"
              />
            )}
          </div>

          {/* Right: Connect or Expand/Collapse Button (Always visible on hover, strictly 1-word tooltip) */}
          <div className="flex items-center shrink-0 ml-auto pl-1 pr-1">
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (activeCategory === 'sftp') {
                        handleOpenSFTP(conn, e);
                      } else if (isSsh) {
                        handleOpenTerminal(conn, e);
                      } else if (isDb) {
                        if (isConnected) {
                          const existingTab = tabs.find((t) => t.connectionId === conn.id && t.type === 'database');
                          if (existingTab) {
                            setActiveTab(existingTab.id);
                          }
                          toggleConnTree(conn, e);
                        } else {
                          handleOpenDatabase(conn, e);
                          if (!expandedConnTree[conn.id]) {
                            toggleConnTree(conn, e);
                          }
                        }
                      } else {
                        handleOpenSFTP(conn, e);
                      }
                    }}
                    className={`h-5 w-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all ${
                      activeCategory === 'sftp'
                        ? 'text-amber-400 hover:text-white hover:bg-amber-600/30'
                        : isDb && isConnected
                        ? 'text-foreground hover:bg-muted'
                        : isDb
                        ? 'text-purple-400 hover:text-white hover:bg-purple-600/30'
                        : isSsh
                        ? 'text-emerald-400 hover:text-white hover:bg-emerald-600/30'
                        : 'text-amber-400 hover:text-white hover:bg-amber-600/30'
                    }`}
                  >
                    {activeCategory === 'sftp' ? (
                      <FolderOpen className="w-2.5 h-2.5" />
                    ) : isDb && isConnected ? (
                      isTreeExpanded ? (
                        <ChevronDown className="w-3 h-3 text-foreground" />
                      ) : (
                        <ChevronRight className="w-3 h-3 text-foreground" />
                      )
                    ) : isConnected ? (
                      <RefreshCw className="w-2.5 h-2.5 text-emerald-400" />
                    ) : (
                      <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" align="end" sideOffset={4} className="text-[10px] font-medium py-0.5 px-1.5 font-sans pointer-events-none shadow-md z-50">
                  <p>{activeCategory === 'sftp' ? 'Browse SFTP' : isDb && isConnected ? (isTreeExpanded ? 'Collapse' : 'Expand') : isConnected ? 'Reconnect' : 'Connect'}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Hierarchical Database Navigator */}
        {isDb && isTreeExpanded && (
          <div className="ml-3 pl-1.5 border-l border-border space-y-0.5 my-0.5 select-none font-sans">
            {connSchemas[conn.id]?.loading ? (
              <div className="flex items-center gap-1.5 py-1 px-1 text-[10.5px] text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin text-purple-500" />
                <span>Loading databases...</span>
              </div>
            ) : connSchemas[conn.id]?.error ? (
              <div className="py-1 px-1 text-[10px] text-rose-500 flex items-center justify-between gap-1">
                <span className="truncate">{connSchemas[conn.id]?.error}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConnSchemas((prev) => ({ ...prev, [conn.id]: { loading: false, databases: undefined, error: undefined } }));
                    toggleConnTree(conn, e);
                  }}
                  className="text-[10px] text-primary hover:underline shrink-0 font-medium px-1 py-0.5 rounded bg-primary/10"
                >
                  Retry
                </button>
              </div>
            ) : (
              (connSchemas[conn.id]?.databases || []).map((db: any) => {
                const dbKey = `${conn.id}:${db.name}`;
                const isDbExpanded = expandedDbNodes[dbKey];

                return (
                  <div key={db.name}>
                    {/* Database Item */}
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedDbNodes((prev) => ({ ...prev, [dbKey]: !prev[dbKey] }));
                      }}
                      className="flex items-center gap-1.5 h-5 px-1 rounded hover:bg-muted text-foreground cursor-pointer text-[11px]"
                    >
                      <ChevronRight
                        className={`w-2.5 h-2.5 text-muted-foreground transition-transform ${
                          isDbExpanded ? 'rotate-90 text-foreground' : ''
                        }`}
                      />
                      <DbCylinderIcon />
                      <span className="truncate font-medium text-foreground">{db.name}</span>
                    </div>

                    {/* Inside Database */}
                    {isDbExpanded && (
                      <div className="ml-2.5 pl-1.5 border-l border-border space-y-0.5 my-0.5">
                        {[
                          {
                            key: 'tables',
                            label: 'Tables',
                            items: db.tables || [],
                            icon: (open: boolean) => <SchemaFolderBranchIcon kind="tables" open={open} />,
                            itemIcon: () => <SchemaTableIcon />,
                            shouldShow: true,
                          },
                          {
                            key: 'foreignTables',
                            label: 'Foreign Tables',
                            items: db.foreignTables || [],
                            icon: (open: boolean) => <SchemaFolderBranchIcon kind="foreignTables" open={open} />,
                            itemIcon: () => <SchemaForeignTableIcon />,
                            shouldShow: (db.foreignTables && db.foreignTables.length > 0) || (conn as any).dbType === 'postgres' || (conn as any).dbType === 'postgresql',
                          },
                          {
                            key: 'views',
                            label: 'Views',
                            items: db.views || [],
                            icon: (open: boolean) => <SchemaFolderBranchIcon kind="views" open={open} />,
                            itemIcon: () => <SchemaViewIcon />,
                            shouldShow: (db.views && db.views.length > 0) || (conn as any).dbType === 'postgres' || (conn as any).dbType === 'postgresql' || (conn as any).dbType === 'clickhouse',
                          },
                          {
                            key: 'materializedViews',
                            label: 'Materialized Views',
                            items: db.materializedViews || [],
                            icon: (open: boolean) => <SchemaFolderBranchIcon kind="materializedViews" open={open} />,
                            itemIcon: () => <SchemaMatViewIcon />,
                            shouldShow: (db.materializedViews && db.materializedViews.length > 0) || (conn as any).dbType === 'postgres' || (conn as any).dbType === 'postgresql' || (conn as any).dbType === 'clickhouse',
                          },
                        ]
                          .filter((cat) => cat.shouldShow)
                          .map((cat) => {
                            const catKey = `${conn.id}:${db.name}:${cat.key}`;
                            const isCatExpanded = expandedDbNodes[catKey];

                            return (
                              <div key={cat.key}>
                                <div
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedDbNodes((prev) => ({ ...prev, [catKey]: !prev[catKey] }));
                                  }}
                                  className="flex items-center gap-1.5 h-5 px-1 rounded hover:bg-muted text-foreground cursor-pointer text-[11px]"
                                >
                                  <ChevronRight
                                    className={`w-2.5 h-2.5 text-muted-foreground transition-transform ${
                                      isCatExpanded ? 'rotate-90 text-foreground' : ''
                                    }`}
                                  />
                                  {cat.icon(isCatExpanded)}
                                  <span className="truncate font-medium text-foreground">{cat.label}</span>
                                  {cat.items.length > 0 && (
                                    <span className="text-[9px] text-muted-foreground/60 font-mono ml-auto pr-1">
                                      {cat.items.length}
                                    </span>
                                  )}
                                </div>

                                {/* Items List inside this category */}
                                {isCatExpanded && (
                                  <div className="ml-2.5 pl-1.5 border-l border-border space-y-0.5 my-0.5">
                                    {cat.items.length === 0 ? (
                                      <div className="text-[10px] text-muted-foreground italic px-2 h-4 flex items-center">
                                        (empty)
                                      </div>
                                    ) : (
                                      cat.items.map((t: any) => {
                                        const tableKey = `${conn.id}:${db.name}:${t.name}`;
                                        const isSelectedTable = selectedTable === tableKey;
                                        const isTableExpanded = !!expandedTables[tableKey];
                                        const schemaObj = connSchemas[conn.id]?.schema;
                                        const tableCols = (schemaObj && (schemaObj[`${db.name}.${t.name}`] || schemaObj[t.name])) || [];

                                        return (
                                          <div key={t.name} className="flex flex-col">
                                            <div
                                              draggable={true}
                                              onDragStart={(e) => {
                                                e.dataTransfer.setData('text/plain', `${db.name}.${t.name}`);
                                                e.dataTransfer.effectAllowed = 'copy';
                                              }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setSelectedTable(tableKey);
                                              }}
                                              onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                handleOpenTableQuery(conn, db.name, t.name);
                                              }}
                                              onContextMenu={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setSelectedTable(tableKey);
                                                setContextMenu(null);
                                                setFolderContextMenu(null);
                                                setCanvasContextMenu(null);
                                                setTableContextMenu({
                                                  x: Math.min(e.clientX, window.innerWidth - 200),
                                                  y: Math.min(e.clientY, window.innerHeight - 200),
                                                  conn,
                                                  dbName: db.name,
                                                  tableName: t.name,
                                                });
                                              }}
                                              className={`flex items-center gap-1 h-5 px-1 rounded cursor-grab active:cursor-grabbing text-[11px] truncate transition-colors group ${
                                                isSelectedTable
                                                  ? 'bg-accent text-accent-foreground ring-1 ring-border font-medium'
                                                  : 'hover:bg-muted text-foreground'
                                              }`}
                                              title={`Drag to query editor or double click to SELECT * FROM ${db.name}.${t.name}`}
                                            >
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  setExpandedTables((prev) => ({ ...prev, [tableKey]: !prev[tableKey] }));
                                                }}
                                                className="p-0.5 hover:bg-muted rounded cursor-pointer shrink-0"
                                                title={isTableExpanded ? 'Collapse columns' : 'Expand columns'}
                                              >
                                                <ChevronRight
                                                  className={`w-2.5 h-2.5 text-muted-foreground transition-transform ${
                                                    isTableExpanded ? 'rotate-90 text-foreground' : ''
                                                  }`}
                                                />
                                              </button>
                                              {cat.itemIcon()}
                                              <span className="truncate text-foreground font-medium">{t.name}</span>
                                              {tableCols.length > 0 && (
                                                <span className="text-[9px] text-muted-foreground/60 font-mono ml-auto pr-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                  {tableCols.length} cols
                                                </span>
                                              )}
                                            </div>

                                            {/* Columns List when item is expanded */}
                                            {isTableExpanded && (
                                              <div className="ml-3 pl-1.5 border-l border-border/60 space-y-0.5 my-0.5 animate-in fade-in duration-100">
                                                {tableCols.length === 0 ? (
                                                  <div className="text-[10px] text-muted-foreground italic px-1 h-4 flex items-center">
                                                    No columns found
                                                  </div>
                                                ) : (
                                                  tableCols.map((col: any) => (
                                                    <div
                                                      key={col.name}
                                                      draggable={true}
                                                      onDragStart={(e) => {
                                                        e.dataTransfer.setData('text/plain', col.name);
                                                        e.dataTransfer.effectAllowed = 'copy';
                                                      }}
                                                      className="flex items-center justify-between gap-1 h-4 px-1 rounded text-[10.5px] hover:bg-muted/40 font-mono text-muted-foreground select-none cursor-grab active:cursor-grabbing"
                                                      title={`Drag column to editor · ${col.name} (${col.type})${col.key === 'PRI' || col.isPk ? ' - Primary Key' : ''}`}
                                                    >
                                                      <div className="flex items-center gap-1 min-w-0">
                                                        {col.key === 'PRI' || col.isPk ? (
                                                          <Key className="w-2.5 h-2.5 text-amber-500 shrink-0" />
                                                        ) : (
                                                          <Columns className="w-2.5 h-2.5 text-muted-foreground/60 shrink-0" />
                                                        )}
                                                        <span className="truncate text-foreground text-[10.5px]">{col.name}</span>
                                                      </div>
                                                      <span className="text-[9px] text-muted-foreground/70 shrink-0 font-mono">{col.type}</span>
                                                    </div>
                                                  ))
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    );
  }

  if (collapsed) {
    return (
      <aside className="w-11 border-r border-zinc-800 bg-zinc-950 flex flex-col items-center py-2.5 gap-2 shrink-0 select-none">
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onToggleCollapse}
                className="text-zinc-400 hover:text-white h-7 w-7"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Expand Sidebar</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onNewConnection}
                className="text-zinc-400 hover:text-white h-7 w-7"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Add Connection</p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowImportExport(true)}
                className="text-zinc-400 hover:text-white h-7 w-7"
              >
                <ArrowUpDown className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Import / Export Connections</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <div className="w-6 h-px bg-zinc-800 my-1" />

        <div className="flex flex-col gap-2">
          {dbConns.length > 0 && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={() => {
                      setActiveCategory('database');
                      onToggleCollapse();
                    }}
                    className="w-7 h-7 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-purple-400 cursor-pointer hover:border-purple-500/50"
                  >
                    <Database className="w-3.5 h-3.5" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>{dbConns.length} Databases</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {sshConns.length > 0 && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    onClick={() => {
                      setActiveCategory('ssh');
                      onToggleCollapse();
                    }}
                    className="w-7 h-7 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400 cursor-pointer hover:border-emerald-500/50"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Terminal</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  onClick={() => {
                    setActiveCategory('sftp');
                    onToggleCollapse();
                  }}
                  className="w-7 h-7 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center text-amber-400 cursor-pointer hover:border-amber-500/50"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>SFTP</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {showImportExport && (
          <ImportExportModal onClose={() => setShowImportExport(false)} />
        )}
      </aside>
    );
  }

  // Group connections by folder
  const rootConns = currentCategoryConns.filter((c) => !c.folder);

  return (
    <aside
      style={{ width: width ? `${width}px` : undefined }}
      className={`${width ? '' : 'w-64'} border-r border-border bg-card text-card-foreground flex flex-col shrink-0 select-none overflow-hidden relative`}
      onClick={() => {
        setContextMenu(null);
        setFolderContextMenu(null);
      }}
    >
      {/* Top Header */}
      <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between gap-1 shrink-0 bg-card select-none">
        <div className="flex items-center gap-1.5 min-w-0 shrink">
          <Server className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider font-mono truncate">
            Connections
          </span>
          <Badge variant="outline" className="text-[9.5px] px-1 py-0 h-3.5 border-border bg-muted text-muted-foreground font-mono shrink-0">
            {connections.length}
          </Badge>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  onClick={() => {
                    setNewConnInitialFolder(undefined);
                    onNewConnection();
                  }}
                  className="h-6 px-2 text-[11px] bg-primary hover:bg-primary/90 text-primary-foreground font-medium gap-1 shadow-sm"
                >
                  <Plus className="w-3 h-3" />
                  Add
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>Add</p></TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={handleRefreshConnections}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted h-6 w-6"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-sky-500 ${isRefreshing ? 'animate-spin' : ''}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>Refresh</p></TooltipContent>
            </Tooltip>

            {/* Compact More Actions Dropdown (Prevents toolbar overflowing into title) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground hover:bg-muted h-6 w-6"
                >
                  <MoreHorizontal className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 bg-popover border-border text-xs text-popover-foreground shadow-xl p-1">
                <DropdownMenuItem onClick={() => setFolderDialog({ open: true, folderName: '' })} className="cursor-pointer gap-2">
                  <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                  <span>New Folder</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    const anyOpen = Object.values(expandedFolders).some((v) => v !== false);
                    if (anyOpen) handleCollapseAllFolders();
                    else handleExpandAllFolders();
                  }}
                  className="cursor-pointer gap-2"
                >
                  <ChevronsUpDown className="w-3.5 h-3.5 text-purple-400" />
                  <span>Toggle All Folders</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="my-1 bg-border" />
                <DropdownMenuItem onClick={() => setShowImportExport(true)} className="cursor-pointer gap-2">
                  <ArrowUpDown className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Import / Export</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onToggleCollapse}
                  className="text-muted-foreground hover:text-foreground hover:bg-muted h-6 w-6"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>Collapse</p></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      {/* Tabs Switcher: Database | Terminal | SFTP */}
      <div className="px-2 pt-1.5 shrink-0 bg-card border-b border-border/70 flex items-center gap-1">
        <button
          onClick={() => setActiveCategory('database')}
          className={`flex items-center gap-1.5 pb-1.5 pt-0.5 px-2 text-[11px] font-medium border-b-2 transition-all cursor-pointer ${
            activeCategory === 'database'
              ? 'border-purple-500 text-foreground font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          title="Databases"
        >
          <Database className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          <span>Database</span>
          <span className="text-[9.5px] text-muted-foreground/80 font-mono">({dbConns.length})</span>
        </button>

        <button
          onClick={() => setActiveCategory('ssh')}
          className={`flex items-center gap-1.5 pb-1.5 pt-0.5 px-2 text-[11px] font-medium border-b-2 transition-all cursor-pointer ${
            activeCategory === 'ssh'
              ? 'border-emerald-500 text-foreground font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          title="Terminal (SSH)"
        >
          <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>Terminal</span>
          <span className="text-[9.5px] text-muted-foreground/80 font-mono">({sshConns.length})</span>
        </button>

        <button
          onClick={() => setActiveCategory('sftp')}
          className={`flex items-center gap-1.5 pb-1.5 pt-0.5 px-2 text-[11px] font-medium border-b-2 transition-all cursor-pointer ${
            activeCategory === 'sftp'
              ? 'border-amber-500 text-foreground font-semibold'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          title="SFTP Storage"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>SFTP</span>
          <span className="text-[9.5px] text-muted-foreground/80 font-mono">({sftpConns.length})</span>
        </button>
      </div>

      {/* Filter / Search Bar */}
      <div className="px-1.5 py-1 border-b border-border shrink-0 bg-card">
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${activeCategory === 'database' ? 'databases' : activeCategory === 'ssh' ? 'servers' : 'storage'}...`}
            className="h-6.5 text-xs pl-6 bg-muted/40 border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
          />
        </div>
      </div>

      {/* Scrollable Canvas for Active Category */}
      <ScrollArea
        className="flex-1 px-1.5 py-1.5"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu(null);
          setFolderContextMenu(null);
          setCanvasContextMenu({
            x: Math.min(e.clientX, window.innerWidth - 220),
            y: Math.min(e.clientY, window.innerHeight - 200),
          });
        }}
      >
        <div
          className="min-h-full flex flex-col space-y-1"
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu(null);
            setFolderContextMenu(null);
            setCanvasContextMenu({
              x: Math.min(e.clientX, window.innerWidth - 220),
              y: Math.min(e.clientY, window.innerHeight - 200),
            });
          }}
        >
          {currentCategoryConns.length === 0 && activeFolders.length === 0 ? (
            <div className="text-center py-8 px-2 space-y-2 select-none">
              {activeCategory === 'database' ? (
                <Database className="w-6 h-6 text-zinc-600 mx-auto opacity-50" />
              ) : activeCategory === 'ssh' ? (
                <Terminal className="w-6 h-6 text-zinc-600 mx-auto opacity-50" />
              ) : (
                <FolderOpen className="w-6 h-6 text-zinc-600 mx-auto opacity-50" />
              )}
              <p className="text-xs text-zinc-500">
                No {activeCategory === 'database' ? 'databases' : activeCategory === 'ssh' ? 'SSH servers' : 'SFTP connections'}
              </p>
              <div className="flex items-center justify-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setFolderDialog({ open: true, folderName: '' })}
                  className="h-6 text-[11px] border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                >
                  <FolderPlus className="w-3 h-3 mr-1 text-amber-400" /> New Folder
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onNewConnection}
                  className="h-6 text-[11px] border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Folders List */}
              {activeFolders.map((folderName) => {
                const folderConns = currentCategoryConns.filter((c) => c.folder === folderName);
                const isOpen = isFolderOpen(folderName);

                return (
                  <div key={folderName} className="space-y-0.5">
                    {/* Folder Header with Drag and Drop */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverFolder !== folderName) setDragOverFolder(folderName);
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                        if (dragOverFolder === folderName) setDragOverFolder(null);
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragOverFolder(null);
                        setDraggingConnId(null);
                        const connId = e.dataTransfer.getData('text/plain') || draggingConnId;
                        if (connId) {
                          const conn = connections.find((c) => c.id === connId);
                          if (conn && conn.folder !== folderName) {
                            await handleMoveConnection(conn, folderName);
                          }
                        }
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFolder(folderName);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu(null);
                        setCanvasContextMenu(null);
                        setFolderContextMenu({
                          x: Math.min(e.clientX, window.innerWidth - 200),
                          y: Math.min(e.clientY, window.innerHeight - 230),
                          folderName,
                        });
                      }}
                      className={`group flex items-center justify-between px-1.5 py-1 text-xs font-medium rounded-md cursor-pointer transition-all ${
                        dragOverFolder === folderName
                          ? 'bg-purple-950/70 ring-1 ring-purple-500 text-white'
                          : 'text-zinc-300 hover:text-white hover:bg-zinc-900/90'
                      }`}
                      title="Right-click for folder actions"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        {isOpen ? (
                          <ChevronDown className="w-3 h-3 text-zinc-500" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-zinc-500" />
                        )}
                        {isOpen ? (
                          <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : (
                          <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                        <span className="truncate font-semibold text-zinc-200">{folderName}</span>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-[10px] text-zinc-500 font-mono">({folderConns.length})</span>

                        {/* Quick add connection to this folder */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setNewConnInitialFolder(folderName);
                            onNewConnection();
                          }}
                          className="opacity-0 group-hover:opacity-100 hover:text-white text-zinc-400 p-0.5 rounded transition-opacity"
                          title={`Add connection to "${folderName}"`}
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Folder Children */}
                    {isOpen && (
                      <div className="pl-2 ml-2.5 border-l border-zinc-800/70 space-y-0.5 pt-0.5 pb-1">
                        {folderConns.length === 0 ? (
                          <div className="text-[10px] text-zinc-600 italic px-2 py-0.5">
                            Folder is empty (Drag & drop or right-click to add)
                          </div>
                        ) : (
                          folderConns.map((conn) => renderConnectionItem(conn, true))
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Root Level Connections (Drop zone to move out of folders) */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'move';
                  if (!dragOverRoot) setDragOverRoot(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setDragOverRoot(false);
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOverRoot(false);
                  setDraggingConnId(null);
                  const connId = e.dataTransfer.getData('text/plain') || draggingConnId;
                  if (connId) {
                    const conn = connections.find((c) => c.id === connId);
                    if (conn && conn.folder) {
                      await handleMoveConnection(conn, null);
                    }
                  }
                }}
                className={`space-y-0.5 pt-0.5 transition-all ${
                  dragOverRoot ? 'ring-1 ring-emerald-500/80 bg-emerald-950/20 rounded p-1' : ''
                }`}
              >
                {rootConns.length > 0 && activeFolders.length > 0 && (
                  <div className="px-2 py-0.5 text-[9px] font-mono uppercase tracking-wider text-zinc-500 font-semibold flex items-center justify-between">
                    <span>Root Connections</span>
                    {dragOverRoot && <span className="text-emerald-400 font-normal">Drop to move out</span>}
                  </div>
                )}
                {rootConns.map((conn) => renderConnectionItem(conn, false))}
              </div>
            </>
          )}

          {/* Full-height empty area that captures clicks / right-clicks anywhere in remaining canvas space and accepts drag out of folders */}
          <div
            className={`flex-1 min-h-[160px] cursor-default transition-all ${
              dragOverRoot ? 'border border-dashed border-emerald-500/50 bg-emerald-950/10 rounded-lg m-1' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (!dragOverRoot) setDragOverRoot(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragOverRoot(false);
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragOverRoot(false);
              setDraggingConnId(null);
              const connId = e.dataTransfer.getData('text/plain') || draggingConnId;
              if (connId) {
                const conn = connections.find((c) => c.id === connId);
                if (conn && conn.folder) {
                  await handleMoveConnection(conn, null);
                }
              }
            }}
            onClick={() => setSelectedConnId(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu(null);
              setFolderContextMenu(null);
              setCanvasContextMenu({
                x: Math.min(e.clientX, window.innerWidth - 220),
                y: Math.min(e.clientY, window.innerHeight - 200),
              });
            }}
          />
        </div>
      </ScrollArea>

      {/* Canvas Empty Area Context Menu */}
      {canvasContextMenu && (
        <>
          <div
            className="fixed inset-0 z-50 bg-transparent"
            onClick={() => setCanvasContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCanvasContextMenu(null);
            }}
          />
          <div
            style={{ top: `${canvasContextMenu.y}px`, left: `${canvasContextMenu.x}px` }}
            className="fixed z-50 w-56 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 shadow-2xl py-1 text-xs select-none animate-in fade-in duration-100"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono text-zinc-400 border-b border-zinc-800/80 truncate flex items-center justify-between">
              <span>EXPLORER</span>
              <span className="text-[9px] text-zinc-500 uppercase">{activeCategory}</span>
            </div>

            <button
              onClick={() => {
                setCanvasContextMenu(null);
                setNewConnInitialFolder(undefined);
                onNewConnection();
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <Plus className="w-3.5 h-3.5 text-emerald-400" />
                <span>New Connection...</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Alt+N</span>
            </button>

            <button
              onClick={() => {
                setCanvasContextMenu(null);
                setFolderDialog({ open: true, folderName: '' });
              }}
              className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <FolderPlus className="w-3.5 h-3.5 text-amber-400" />
                <span>New Folder...</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-500">Alt+F</span>
            </button>

            <div className="h-px bg-zinc-800 my-1" />

            <button
              onClick={() => {
                setCanvasContextMenu(null);
                handleExpandAllFolders();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
              <span>Expand All Folders</span>
            </button>

            <button
              onClick={() => {
                setCanvasContextMenu(null);
                handleCollapseAllFolders();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Folder className="w-3.5 h-3.5 text-zinc-400" />
              <span>Collapse All Folders</span>
            </button>

            <div className="h-px bg-zinc-800 my-1" />

            <button
              onClick={() => {
                setCanvasContextMenu(null);
                handleRefreshConnections();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
              <span>Refresh Connections</span>
            </button>
          </div>
        </>
      )}

      {/* Connection Context Menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-50 bg-transparent"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
            className="fixed z-50 w-52 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 shadow-2xl py-1 text-xs select-none animate-in fade-in duration-100"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono text-zinc-400 border-b border-zinc-800/80 truncate flex items-center gap-1.5">
              {contextMenu.conn.type === 'database' ? (
                getDatabaseIcon(contextMenu.conn)
              ) : contextMenu.conn.type === 'ssh' ? (
                <Terminal className="w-3 h-3 text-emerald-400" />
              ) : (
                <FolderOpen className="w-3 h-3 text-amber-400" />
              )}
              <span className="truncate font-semibold">{contextMenu.conn.name}</span>
            </div>

            {tabs.some((t) => t.connectionId === contextMenu.conn.id && (contextMenu.conn.type !== 'ssh' || tabStatuses[t.id] === 'connected')) ? (
              <button
                onClick={() => {
                  const c = contextMenu.conn;
                  setContextMenu(null);
                  handleDisconnect(c);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-rose-950/40 text-rose-400 hover:text-rose-300 transition-colors text-left"
              >
                <PowerOff className="w-3.5 h-3.5 text-rose-400" />
                <span>Disconnect</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  const c = contextMenu.conn;
                  setContextMenu(null);
                  if (activeCategory === 'sftp') handleOpenSFTP(c);
                  else if (c.type === 'ssh') handleOpenTerminal(c);
                  else if (c.type === 'database') handleOpenDatabase(c);
                  else if (c.type === 'sftp') handleOpenSFTP(c);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
              >
                {activeCategory === 'sftp' ? (
                  <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <Play className="w-3.5 h-3.5 text-emerald-400 fill-current" />
                )}
                <span>{activeCategory === 'sftp' ? 'Open SFTP' : tabs.some((t) => t.connectionId === contextMenu.conn.id) ? 'Reconnect' : 'Connect'}</span>
              </button>
            )}

            {/* Quick cross-launch between SSH Terminal and SFTP */}
            {contextMenu.conn.type === 'ssh' && activeCategory !== 'sftp' && (
              <button
                onClick={() => {
                  const c = contextMenu.conn;
                  setContextMenu(null);
                  handleOpenSFTP(c);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
                <span>Open SFTP Browser</span>
              </button>
            )}
            {contextMenu.conn.type === 'ssh' && activeCategory === 'sftp' && (
              <button
                onClick={() => {
                  const c = contextMenu.conn;
                  setContextMenu(null);
                  handleOpenTerminal(c);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
              >
                <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                <span>Open SSH Terminal</span>
              </button>
            )}

            <button
              onClick={() => {
                const c = contextMenu.conn;
                setContextMenu(null);
                setEditingConn(c);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-400" />
              <span>Edit Connection...</span>
            </button>

            <button
              onClick={() => {
                const c = contextMenu.conn;
                setContextMenu(null);
                setMoveDialog({ open: true, conn: c });
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <FolderInput className="w-3.5 h-3.5 text-amber-400" />
              <span>Move to Folder...</span>
            </button>

            <button
              onClick={() => {
                const c = contextMenu.conn;
                setContextMenu(null);
                handleDuplicate(c);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Copy className="w-3.5 h-3.5 text-sky-400" />
              <span>Duplicate</span>
            </button>

            <div className="h-px bg-zinc-800 my-1" />

            <button
              onClick={(e) => {
                const c = contextMenu.conn;
                setContextMenu(null);
                handleDelete(c, e);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-rose-950/50 text-rose-400 hover:text-rose-300 transition-colors text-left"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Connection</span>
            </button>
          </div>
        </>
      )}

      {/* Folder Context Menu */}
      {folderContextMenu && (
        <>
          <div
            className="fixed inset-0 z-50 bg-transparent"
            onClick={() => setFolderContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setFolderContextMenu(null);
            }}
          />
          <div
            style={{ top: `${folderContextMenu.y}px`, left: `${folderContextMenu.x}px` }}
            className="fixed z-50 w-56 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 shadow-2xl py-1 text-xs select-none animate-in fade-in duration-100"
          >
            <div className="px-2.5 py-1 text-[10px] font-mono text-zinc-400 border-b border-zinc-800/80 truncate flex items-center gap-1.5">
              <Folder className="w-3 h-3 text-amber-400" />
              <span className="truncate font-semibold">{folderContextMenu.folderName}</span>
            </div>

            <button
              onClick={() => {
                const f = folderContextMenu.folderName;
                setFolderContextMenu(null);
                setNewConnInitialFolder(f);
                onNewConnection();
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Plus className="w-3.5 h-3.5 text-emerald-400" />
              <span>Add Connection here...</span>
            </button>

            <button
              onClick={() => {
                const f = folderContextMenu.folderName;
                setFolderContextMenu(null);
                toggleFolder(f);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <FolderOpen className="w-3.5 h-3.5 text-zinc-400" />
              <span>{isFolderOpen(folderContextMenu.folderName) ? 'Collapse Folder' : 'Expand Folder'}</span>
            </button>

            <button
              onClick={() => {
                const f = folderContextMenu.folderName;
                setFolderContextMenu(null);
                setFolderDialog({ open: true, folderName: f, isRename: true, oldName: f });
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Edit3 className="w-3.5 h-3.5 text-amber-400" />
              <span>Rename Folder...</span>
            </button>

            <div className="h-px bg-zinc-800 my-1" />

            <button
              onClick={() => {
                const f = folderContextMenu.folderName;
                setFolderContextMenu(null);
                handleDeleteFolder(f);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 text-zinc-300 hover:text-white transition-colors text-left"
            >
              <Trash2 className="w-3.5 h-3.5 text-zinc-400" />
              <span>Delete Folder (Keep items)</span>
            </button>

            <button
              onClick={() => {
                const f = folderContextMenu.folderName;
                setFolderContextMenu(null);
                handleDeleteFolderAndConns(f);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-rose-950/50 text-rose-400 hover:text-rose-300 transition-colors text-left"
            >
              <FolderX className="w-3.5 h-3.5" />
              <span>Delete Folder & Connections</span>
            </button>
          </div>
        </>
      )}

      {/* Table Context Menu */}
      {tableContextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setTableContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setTableContextMenu(null);
            }}
          />
          <div
            style={{ top: tableContextMenu.y, left: tableContextMenu.x }}
            className="fixed z-50 w-52 bg-zinc-950 border border-zinc-800 rounded-md shadow-2xl py-1 text-xs text-zinc-300 select-none animate-in fade-in-0 zoom-in-95 duration-75"
          >
            <div className="px-2.5 py-1 text-[10.5px] text-zinc-400 border-b border-zinc-800/80 flex items-center gap-1.5 truncate font-mono">
              <SchemaTableIcon />
              <span className="truncate font-semibold text-white">
                {tableContextMenu.dbName}.{tableContextMenu.tableName}
              </span>
            </div>

            <button
              onClick={() => {
                const { conn, dbName, tableName } = tableContextMenu;
                setTableContextMenu(null);
                handleOpenTableQuery(conn, dbName, tableName);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Play className="w-3.5 h-3.5 text-purple-400" />
              <span>Query data (LIMIT 100)</span>
            </button>

            <button
              onClick={() => {
                const { conn, dbName, tableName } = tableContextMenu;
                setTableContextMenu(null);
                handleOpenTableQuery(conn, dbName, tableName, 'count');
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Database className="w-3.5 h-3.5 text-sky-400" />
              <span>Count Rows (count(*))</span>
            </button>

            <div className="h-px bg-zinc-800 my-1" />

            <button
              onClick={() => {
                navigator.clipboard.writeText(tableContextMenu.tableName);
                toast.success('Table name copied');
                setTableContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
              <span>Copy Table Name</span>
            </button>

            <button
              onClick={() => {
                navigator.clipboard.writeText(`${tableContextMenu.dbName}.${tableContextMenu.tableName}`);
                toast.success('Full table path copied');
                setTableContextMenu(null);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-zinc-800 hover:text-white transition-colors text-left"
            >
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
              <span>Copy Full Name (db.table)</span>
            </button>
          </div>
        </>
      )}

      {/* New / Rename Folder Dialog */}
      {folderDialog && (
        <Dialog open onOpenChange={() => setFolderDialog(null)}>
          <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 sm:max-w-[360px] p-4 shadow-2xl">
            <DialogHeader className="pb-2 border-b border-zinc-800">
              <DialogTitle className="text-sm font-semibold text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-amber-400" />
                {folderDialog.isRename ? 'Rename Folder' : 'Create New Folder'}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-2 py-2">
              <Label className="text-xs text-zinc-300">Folder Name</Label>
              <Input
                autoFocus
                placeholder="e.g. Production, Analytics, Telkomsel"
                value={folderDialog.folderName}
                onChange={(e) => setFolderDialog((prev) => prev ? { ...prev, folderName: e.target.value } : null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveFolder();
                }}
                className="h-8 text-xs bg-zinc-900 border-zinc-700"
              />
            </div>

            <DialogFooter className="pt-2 flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setFolderDialog(null)}
                className="h-7 text-xs border-zinc-800 text-zinc-400"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveFolder}
                className="h-7 text-xs bg-white text-zinc-950 hover:bg-zinc-200"
              >
                {folderDialog.isRename ? 'Rename' : 'Create Folder'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Move Connection to Folder Dialog */}
      {moveDialog && (
        <Dialog open onOpenChange={() => setMoveDialog(null)}>
          <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 sm:max-w-[380px] p-4 shadow-2xl">
            <DialogHeader className="pb-2 border-b border-zinc-800">
              <DialogTitle className="text-sm font-semibold text-white flex items-center gap-2">
                <FolderInput className="w-4 h-4 text-amber-400" />
                Move "{moveDialog.conn.name}"
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-1.5 py-2">
              <p className="text-[11px] text-zinc-400 pb-1">Select target folder:</p>

              {/* Option: Root (No Folder) */}
              <button
                onClick={() => handleMoveConnection(moveDialog.conn, null)}
                className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs transition-colors ${
                  !moveDialog.conn.folder
                    ? 'bg-zinc-800 text-white font-semibold'
                    : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-2">
                  <CornerDownRight className="w-3.5 h-3.5 text-zinc-400" />
                  <span>None (Root level)</span>
                </div>
                {!moveDialog.conn.folder && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </button>

              {/* Existing Folders */}
              {activeFolders.map((f) => (
                <button
                  key={f}
                  onClick={() => handleMoveConnection(moveDialog.conn, f)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md text-xs transition-colors ${
                    moveDialog.conn.folder === f
                      ? 'bg-zinc-800 text-white font-semibold'
                      : 'text-zinc-300 hover:bg-zinc-900 hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span className="truncate">{f}</span>
                  </div>
                  {moveDialog.conn.folder === f && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </button>
              ))}

              <div className="pt-2 border-t border-zinc-800/80">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setMoveDialog(null);
                    setFolderDialog({ open: true, folderName: '' });
                  }}
                  className="w-full h-7 text-xs border-dashed border-zinc-700 text-zinc-300 hover:bg-zinc-900"
                >
                  <FolderPlus className="w-3.5 h-3.5 mr-1.5 text-amber-400" /> Create New Folder...
                </Button>
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMoveDialog(null)}
                className="h-7 text-xs border-zinc-800 text-zinc-400"
              >
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Connection Modal */}
      {editingConn && (
        <NewConnectionModal
          editConnection={editingConn}
          onClose={() => setEditingConn(null)}
        />
      )}

      {/* New Connection Modal with Initial Folder */}
      {newConnInitialFolder !== undefined && (
        <NewConnectionModal
          initialFolder={newConnInitialFolder}
          onClose={() => setNewConnInitialFolder(undefined)}
        />
      )}

      {showImportExport && (
        <ImportExportModal onClose={() => setShowImportExport(false)} />
      )}
    </aside>
  );
}
