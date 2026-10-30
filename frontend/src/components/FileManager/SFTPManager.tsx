import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Folder, File, Upload, Download, Trash2, FolderPlus,
  Edit2, RefreshCw, ArrowUp, ArrowDown, ArrowUpDown, Home, Loader2, HardDrive,
  Terminal, Laptop, ArrowRight, ArrowLeft, Copy, Eye, FolderOpen,
  Search, X, Square, Columns2
} from 'lucide-react';
import { FilePreviewModal } from './FilePreviewModal';
import { api } from '@/utils/api';
import { useAppStore } from '@/store/appStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import toast from 'react-hot-toast';

interface Props {
  tab: {
    id: string;
    connectionId: string;
    connection?: any;
  };
}

interface RemoteFileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
  permissions?: any;
}

interface LocalFileEntry {
  name: string;
  path?: string;
  type: 'file' | 'directory';
  size: number;
  modifiedAt: number;
  permissions?: string;
  filetype?: string;
  fileObj?: File;
}

interface TransferItem {
  name: string;
  size: number;
  direction: 'upload' | 'download';
  status: 'success' | 'failed' | 'in_progress';
  time: string;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(ts: number): string {
  if (!ts) return '—';
  // Check if timestamp is in seconds vs milliseconds
  const ms = ts < 10000000000 ? ts * 1000 : ts;
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  const secs = String(d.getSeconds()).padStart(2, '0');
  return `${month}/${day}/${year} ${hours}:${mins}:${secs}`;
}

function formatPermissions(perm: any): string {
  if (!perm) return '—';
  if (typeof perm === 'string') return perm;
  if (typeof perm === 'object' && perm !== null) {
    const u = perm.user || '---';
    const g = perm.group || '---';
    const o = perm.other || '---';
    return `${u}${g}${o}`;
  }
  if (typeof perm === 'number') {
    return (perm & 0o777).toString(8);
  }
  return String(perm);
}

function getFileType(name: string, isDir: boolean): string {
  if (isDir) return 'File folder';
  const lower = name.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'GZipped TAR Archive';
  if (lower.endsWith('.tar')) return 'TAR Archive';
  if (lower.endsWith('.gz')) return 'GZIP Compressed Archive';
  if (lower.endsWith('.zip')) return 'ZIP Archive';
  if (lower.endsWith('.csv')) return 'Microsoft Excel CSV / Delimited';
  if (lower.endsWith('.tsv')) return 'Tab Delimited File';
  if (lower.endsWith('.json')) return 'JSON Source File';
  if (lower.endsWith('.sql')) return 'SQL Query Script';
  if (lower.endsWith('.log')) return 'Log File';
  if (lower.endsWith('.txt')) return 'Text Document';
  if (lower.endsWith('.cfg') || lower.endsWith('.conf') || lower.endsWith('.ini')) return 'Configuration File';
  if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'Shell Script';
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'Image File';
  if (lower.endsWith('.pdf')) return 'PDF Document';
  if (lower.endsWith('.env')) return 'Environment Config';
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'YAML Document';
  if (lower.endsWith('.xml')) return 'XML Document';
  const ext = name.split('.').pop();
  return ext ? `${ext.toUpperCase()} File` : 'File';
}

export function SFTPManager({ tab }: Props) {
  const openTab = useAppStore((s) => s.openTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const splitTabId = useAppStore((s) => s.splitTabId);
  const isActive = tab.id === activeTabId || tab.id === splitTabId;

  const hasLoadedRemoteRef = useRef(false);
  const hasLoadedLocalRef = useRef(false);

  // Remote site states (defaults to user home directory '.')
  const [remotePath, setRemotePath] = useState('.');
  const [remotePathInput, setRemotePathInput] = useState('');
  const [remoteFiles, setRemoteFiles] = useState<RemoteFileEntry[]>([]);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [selectedRemote, setSelectedRemote] = useState<string | null>(null);
  const [remoteContextMenu, setRemoteContextMenu] = useState<{ x: number; y: number; item: RemoteFileEntry } | null>(null);

  // Local site states (real host filesystem listing or browser picked directory)
  const [localPath, setLocalPath] = useState('');
  const [localPathInput, setLocalPathInput] = useState('');
  const [localParentPath, setLocalParentPath] = useState<string | null>(null);
  const [localFiles, setLocalFiles] = useState<LocalFileEntry[]>([]);
  const [localStats, setLocalStats] = useState<{ fileCount: number; dirCount: number; totalBytes: number }>({
    fileCount: 0,
    dirCount: 0,
    totalBytes: 0,
  });
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [selectedLocal, setSelectedLocal] = useState<string | null>(null);
  const [localContextMenu, setLocalContextMenu] = useState<{ x: number; y: number; item: LocalFileEntry } | null>(null);

  // Logs & Transfers states
  const [logs, setLogs] = useState<string[]>([
    `Status: Connecting to sftp://${tab.connection?.username || 'user'}@${tab.connection?.host || 'remote'}:${tab.connection?.port || 22}...`,
    'Status: Connected. Resolving directory listing...'
  ]);
  const [showLog, setShowLog] = useState(true);
  const [logHeight, setLogHeight] = useState(() => {
    const saved = localStorage.getItem('terminalsql_sftp_log_height');
    return saved ? parseInt(saved, 10) : 80;
  });
  const [isDraggingLog, setIsDraggingLog] = useState(false);
  const logContainerRef = useRef<HTMLDivElement>(null);

  const [showTransferDrawer, setShowTransferDrawer] = useState(false);
  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [isDraggingOverRemote, setIsDraggingOverRemote] = useState(false);
  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean;
    filePath: string;
    fileName: string;
    isLocal?: boolean;
  }>({ isOpen: false, filePath: '', fileName: '', isLocal: false });

  const directUploadRef = useRef<HTMLInputElement>(null);

  // Layout Pane Mode: 'single' (Remote Explorer, Default) vs 'dual' (FileZilla 2-Screen)
  const [paneMode, setPaneMode] = useState<'single' | 'dual'>(() => {
    return (localStorage.getItem('terminalsql_sftp_pane_mode') as 'single' | 'dual') || 'single';
  });

  useEffect(() => {
    localStorage.setItem('terminalsql_sftp_pane_mode', paneMode);
  }, [paneMode]);

  // Sorting & Filtering states
  type SortKey = 'name' | 'size' | 'type' | 'modified' | 'perm';
  type SortOrder = 'asc' | 'desc';

  const [remoteSortKey, setRemoteSortKey] = useState<SortKey>('name');
  const [remoteSortOrder, setRemoteSortOrder] = useState<SortOrder>('asc');
  const [remoteSearchQuery, setRemoteSearchQuery] = useState('');

  const [localSortKey, setLocalSortKey] = useState<SortKey>('name');
  const [localSortOrder, setLocalSortOrder] = useState<SortOrder>('asc');
  const [localSearchQuery, setLocalSearchQuery] = useState('');

  function handleRemoteSort(key: SortKey) {
    if (remoteSortKey === key) {
      setRemoteSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setRemoteSortKey(key);
      setRemoteSortOrder('asc');
    }
  }

  function handleLocalSort(key: SortKey) {
    if (localSortKey === key) {
      setLocalSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setLocalSortKey(key);
      setLocalSortOrder('asc');
    }
  }

  // Column widths (resizable, default null for filename means 100% flexible)
  const [localColWidths, setLocalColWidths] = useState<{ name: number | null; size: number; type: number; modified: number }>({
    name: null, // Flexible auto-width (takes all remaining table width)
    size: 90,
    type: 130,
    modified: 155,
  });
  const [remoteColWidths, setRemoteColWidths] = useState<{ name: number | null; size: number; type: number; modified: number; perm: number }>({
    name: null, // Flexible auto-width (takes all remaining table width)
    size: 90,
    type: 130,
    modified: 155,
    perm: 105,
  });

  const resizingColRef = useRef<{
    pane: 'local' | 'remote';
    col: string;
    startX: number;
    startWidth: number;
  } | null>(null);

  function startColResize(pane: 'local' | 'remote', col: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    // Determine current rendered width of column header
    const thElement = (e.currentTarget.parentElement as HTMLElement);
    const renderedWidth = thElement ? Math.round(thElement.getBoundingClientRect().width) : 200;

    const startWidth = pane === 'local'
      ? ((localColWidths as any)[col] ?? renderedWidth)
      : ((remoteColWidths as any)[col] ?? renderedWidth);

    resizingColRef.current = {
      pane,
      col,
      startX: e.clientX,
      startWidth,
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!resizingColRef.current) return;
      if (moveEvent.buttons === 0) {
        handleMouseUp();
        return;
      }
      const diff = moveEvent.clientX - resizingColRef.current.startX;
      const minW = col === 'size' || col === 'perm' ? 60 : 100;
      const newWidth = Math.max(minW, Math.round(resizingColRef.current.startWidth + diff));

      if (resizingColRef.current.pane === 'local') {
        setLocalColWidths((prev) => ({ ...prev, [resizingColRef.current!.col]: newWidth }));
      } else {
        setRemoteColWidths((prev) => ({ ...prev, [resizingColRef.current!.col]: newWidth }));
      }
    };

    const handleMouseUp = () => {
      resizingColRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function addLog(msg: string) {
    setLogs((prev) => [...prev.slice(-40), msg]);
  }

  // Track fetched path to avoid duplicate fetch loops on mount
  const fetchedPathRef = useRef<string | null>(null);

  // Load Host Local Files
  async function loadLocalFiles(targetPath?: string) {
    setLoadingLocal(true);
    try {
      const res = await api.sftp.localList(targetPath);
      const safePath = res?.path || targetPath || '/';
      const safeFiles = Array.isArray(res?.files) ? res.files : [];
      setLocalPath(safePath);
      setLocalPathInput(safePath);
      setLocalParentPath(res?.parentPath || null);
      setLocalFiles(safeFiles);
      if (res?.stats) {
        setLocalStats({
          fileCount: res.stats.fileCount ?? safeFiles.filter((f) => f.type === 'file').length,
          dirCount: res.stats.dirCount ?? safeFiles.filter((f) => f.type === 'directory').length,
          totalBytes: res.stats.totalBytes ?? safeFiles.reduce((acc, f) => acc + (f.size || 0), 0),
        });
      } else {
        setLocalStats({
          fileCount: safeFiles.filter((f) => f.type === 'file').length,
          dirCount: safeFiles.filter((f) => f.type === 'directory').length,
          totalBytes: safeFiles.reduce((acc, f) => acc + (f.size || 0), 0),
        });
      }
      setSelectedLocal(null);
      addLog(`Status: Directory listing of "${safePath}" successful (${safeFiles.length} items)`);
    } catch (err: any) {
      addLog(`Error: Local directory listing failed: ${err.message || 'Unknown error'}`);
      if (isActive) {
        toast.error(`Failed to read local folder: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setLoadingLocal(false);
    }
  }

  // Load Remote SFTP Files
  async function loadRemoteFiles(p: string) {
    setLoadingRemote(true);
    addLog(`Command: ls "${p}"`);
    try {
      const res = await api.sftp.list(tab.connectionId, p);
      const resolvedPath = res?.path || p;
      if (resolvedPath !== remotePath) {
        fetchedPathRef.current = resolvedPath;
        setRemotePath(resolvedPath);
      }
      setRemotePathInput(resolvedPath);
      const rawFiles = Array.isArray(res?.files) ? res.files : [];
      const sorted = [...rawFiles].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });
      setRemoteFiles(sorted);
      setSelectedRemote(null);
      addLog(`Status: Directory listing of "${resolvedPath}" successful (${sorted.length} items)`);
    } catch (err: any) {
      addLog(`Error: Remote directory listing failed: ${err.message || 'Unknown error'}`);
      if (isActive) {
        toast.error(`Failed to load remote directory: ${err.message || 'Unknown error'}`);
      }
    } finally {
      setLoadingRemote(false);
    }
  }

  // Lazy load remote files: only when tab is active to avoid hammering servers on initial refresh
  useEffect(() => {
    if (!isActive) return;

    if (tab.connectionId && (!hasLoadedRemoteRef.current || fetchedPathRef.current !== remotePath)) {
      hasLoadedRemoteRef.current = true;
      fetchedPathRef.current = remotePath;
      loadRemoteFiles(remotePath);
    }
  }, [isActive, tab.connectionId, remotePath]);

  // Lazy load local files: only when tab is active AND dual-pane mode is enabled
  useEffect(() => {
    if (!isActive || paneMode !== 'dual') return;

    if (!hasLoadedLocalRef.current) {
      hasLoadedLocalRef.current = true;
      loadLocalFiles();
    }
  }, [isActive, paneMode]);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    const handleGlobalClick = () => {
      setRemoteContextMenu(null);
      setLocalContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  const handleMouseDownLog = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLog(true);
    const startY = e.clientY;
    const startHeight = logHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const newHeight = Math.max(36, Math.min(450, startHeight + (moveEvent.clientY - startY)));
      setLogHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDraggingLog(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      setLogHeight((h: number) => {
        localStorage.setItem('terminalsql_sftp_log_height', h.toString());
        return h;
      });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  function canPreviewFile(name: string): boolean {
    const lower = name.toLowerCase();
    const previewExtensions = [
      '.csv', '.tsv', '.txt', '.log', '.json', '.sql', '.sh', '.bash',
      '.env', '.conf', '.cfg', '.ini', '.yaml', '.yml', '.xml', '.md', '.js', '.ts',
      '.py', '.tar', '.tar.gz', '.tgz', '.gz', '.html', '.htm', '.css',
      '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif'
    ];
    return previewExtensions.some((ext) => lower.endsWith(ext));
  }

  // Reusable File Sorter (natural sort, folders always on top)
  function sortFileList<T extends { name: string; size: number; type: string; modifiedAt?: number; permissions?: any; filetype?: string }>(
    items: T[],
    sortKey: SortKey,
    sortOrder: SortOrder,
    isRemote: boolean
  ): T[] {
    const result = [...items];
    result.sort((a, b) => {
      const aIsDir = a.type === 'directory';
      const bIsDir = b.type === 'directory';
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;

      let cmp = 0;
      switch (sortKey) {
        case 'name':
          cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
          break;
        case 'size':
          cmp = (a.size || 0) - (b.size || 0);
          break;
        case 'type': {
          const typeA = a.filetype || getFileType(a.name, aIsDir);
          const typeB = b.filetype || getFileType(b.name, bIsDir);
          cmp = typeA.localeCompare(typeB);
          break;
        }
        case 'modified':
          cmp = (a.modifiedAt || 0) - (b.modifiedAt || 0);
          break;
        case 'perm':
          if (isRemote) {
            const permA = formatPermissions(a.permissions);
            const permB = formatPermissions(b.permissions);
            cmp = permA.localeCompare(permB);
          }
          break;
        default:
          cmp = 0;
      }
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return result;
  }

  // Filtered & Sorted Remote Files
  const sortedAndFilteredRemoteFiles = useMemo(() => {
    let list = remoteFiles;
    if (remoteSearchQuery.trim()) {
      const q = remoteSearchQuery.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    return sortFileList(list, remoteSortKey, remoteSortOrder, true);
  }, [remoteFiles, remoteSearchQuery, remoteSortKey, remoteSortOrder]);

  // Filtered & Sorted Local Files
  const sortedAndFilteredLocalFiles = useMemo(() => {
    let list = localFiles;
    if (localSearchQuery.trim()) {
      const q = localSearchQuery.toLowerCase();
      list = list.filter((f) => f.name.toLowerCase().includes(q));
    }
    return sortFileList(list, localSortKey, localSortOrder, false);
  }, [localFiles, localSearchQuery, localSortKey, localSortOrder]);

  function handlePreviewFile(fileName?: string, isLocal = false) {
    if (isLocal) {
      const target = fileName || selectedLocal;
      if (!target) return;
      const file = localFiles.find((f) => f.name === target);
      const fullPath = file?.path || (localPath === '/' ? `/${target}` : `${localPath}/${target}`);
      setPreviewModal({
        isOpen: true,
        filePath: fullPath,
        fileName: target,
        isLocal: true,
      });
      return;
    }

    const target = fileName || selectedRemote;
    if (!target) return;
    const fullPath = remotePath === '/' ? `/${target}` : `${remotePath}/${target}`;
    setPreviewModal({
      isOpen: true,
      filePath: fullPath,
      fileName: target,
      isLocal: false,
    });
  }

  // Navigation handlers
  function navigateLocal(file: LocalFileEntry) {
    if (file.type === 'directory') {
      const target = file.path || `${localPath === '/' ? '' : localPath}/${file.name}`;
      loadLocalFiles(target);
    } else if (canPreviewFile(file.name)) {
      handlePreviewFile(file.name, true);
    } else {
      handleUploadLocalFile(file);
    }
  }

  function goUpLocal() {
    if (localParentPath) {
      loadLocalFiles(localParentPath);
    }
  }

  function navigateRemote(file: RemoteFileEntry) {
    if (file.type === 'directory') {
      const newPath = remotePath === '/' ? `/${file.name}` : `${remotePath}/${file.name}`;
      setRemotePath(newPath);
    } else if (canPreviewFile(file.name)) {
      handlePreviewFile(file.name, false);
    } else {
      handleDownloadFile(file.name);
    }
  }

  function goUpRemote() {
    if (remotePath === '/') return;
    const parts = remotePath.split('/').filter(Boolean);
    parts.pop();
    setRemotePath('/' + parts.join('/') || '/');
  }

  // Upload Local to Remote
  async function handleUploadLocalFile(item?: LocalFileEntry) {
    const target = item || localFiles.find((f) => f.name === selectedLocal);
    if (!target) {
      toast.error('Select a local file to upload');
      return;
    }

    if (target.type === 'directory') {
      navigateLocal(target);
      return;
    }

    const fullRemoteTarget = remotePath === '/' ? `/${target.name}` : `${remotePath}/${target.name}`;
    addLog(`Command: put "${target.name}" "${fullRemoteTarget}"`);
    const toastId = toast.loading(`Uploading ${target.name}...`);

    try {
      if (target.path) {
        await api.sftp.uploadLocalFile({
          connectionId: tab.connectionId,
          localPath: target.path,
          remotePath: fullRemoteTarget,
        });
      } else if (target.fileObj) {
        await api.sftp.upload(tab.connectionId, fullRemoteTarget, target.fileObj);
      } else {
        throw new Error('Local file reference not available');
      }

      toast.success(`Uploaded ${target.name}`, { id: toastId });
      addLog(`Status: File transfer successful, transferred ${formatSize(target.size)}`);
      setTransfers((prev) => [
        ...prev,
        {
          name: target.name,
          size: target.size,
          direction: 'upload',
          status: 'success',
          time: new Date().toLocaleTimeString(),
        },
      ]);
      loadRemoteFiles(remotePath);
    } catch (err: any) {
      addLog(`Error: Upload failed: ${err.message}`);
      toast.error(`Upload failed: ${err.message}`, { id: toastId });
      setTransfers((prev) => [
        ...prev,
        {
          name: target.name,
          size: target.size,
          direction: 'upload',
          status: 'failed',
          time: new Date().toLocaleTimeString(),
        },
      ]);
    }
  }

  // Download Remote to Local Host Directory
  async function handleDownloadToLocal(fileName?: string) {
    const target = fileName || selectedRemote;
    if (!target) {
      toast.error('Select a remote file to download');
      return;
    }

    const remoteFile = remoteFiles.find((f) => f.name === target);
    if (remoteFile && remoteFile.type === 'directory') {
      navigateRemote(remoteFile);
      return;
    }

    const fullRemotePath = remotePath === '/' ? `/${target}` : `${remotePath}/${target}`;
    addLog(`Command: get "${fullRemotePath}" into "${localPath}"`);
    const toastId = toast.loading(`Downloading ${target} to ${localPath}...`);

    try {
      await api.sftp.downloadToLocal({
        connectionId: tab.connectionId,
        remotePath: fullRemotePath,
        localDir: localPath,
      });

      toast.success(`Downloaded ${target} to local folder`, { id: toastId });
      addLog(`Status: File transfer successful: saved to ${localPath}/${target}`);
      setTransfers((prev) => [
        ...prev,
        {
          name: target,
          size: remoteFile?.size || 0,
          direction: 'download',
          status: 'success',
          time: new Date().toLocaleTimeString(),
        },
      ]);
      loadLocalFiles(localPath);
    } catch (err: any) {
      addLog(`Error: Download failed: ${err.message}`);
      toast.error(`Download failed: ${err.message}`, { id: toastId });
      setTransfers((prev) => [
        ...prev,
        {
          name: target,
          size: remoteFile?.size || 0,
          direction: 'download',
          status: 'failed',
          time: new Date().toLocaleTimeString(),
        },
      ]);
    }
  }

  // Download Remote file directly to PC Browser
  function handleDownloadFile(fileName?: string) {
    const target = fileName || selectedRemote;
    if (!target) return;
    const file = remoteFiles.find((f) => f.name === target);
    if (file && file.type === 'directory') {
      navigateRemote(file);
      return;
    }

    const filePath = `${remotePath === '/' ? '' : remotePath}/${target}`;
    addLog(`Command: get "${filePath}" to browser`);
    const url = api.sftp.download(tab.connectionId, filePath);

    const a = document.createElement('a');
    a.href = url;
    a.download = target;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    toast.success(`Downloading ${target}...`);
    addLog(`Status: File transfer started: get "${target}"`);
  }

  // Pick folder from PC via HTML5 File System Access API
  async function handlePickLocalBrowserFolder() {
    if ('showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker();
        const entries: LocalFileEntry[] = [];
        let totalBytes = 0;
        let fileCount = 0;
        let dirCount = 0;

        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            const file = await entry.getFile();
            entries.push({
              name: file.name,
              type: 'file',
              size: file.size,
              modifiedAt: Math.floor(file.lastModified / 1000),
              filetype: getFileType(file.name, false),
              fileObj: file,
            });
            fileCount++;
            totalBytes += file.size;
          } else {
            entries.push({
              name: entry.name,
              type: 'directory',
              size: 0,
              modifiedAt: 0,
              filetype: 'File folder',
            });
            dirCount++;
          }
        }

        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        setLocalPath(`Browser: /${dirHandle.name}`);
        setLocalPathInput(`Browser: /${dirHandle.name}`);
        setLocalParentPath(null);
        setLocalFiles(entries);
        setLocalStats({ fileCount, dirCount, totalBytes });
        addLog(`Status: Opened browser directory "${dirHandle.name}" (${entries.length} items)`);
        toast.success(`Opened PC folder: ${dirHandle.name}`);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          toast.error(`Could not open directory: ${err.message}`);
        }
      }
    } else {
      toast('Directory picker is supported in Chrome, Edge, and Opera browsers.', { icon: 'ℹ️' });
    }
  }

  // Local Mkdir
  async function handleMkdirLocal() {
    const dirName = prompt('Enter new folder name:');
    if (!dirName) return;
    const targetPath = `${localPath === '/' ? '' : localPath}/${dirName}`;
    try {
      await api.sftp.localMkdir(targetPath);
      toast.success(`Created folder ${dirName}`);
      loadLocalFiles(localPath);
    } catch (err: any) {
      toast.error(`Failed to create folder: ${err.message}`);
    }
  }

  // Local Rename
  async function handleRenameLocal(oldName: string) {
    const newName = prompt('Enter new name:', oldName);
    if (!newName || newName === oldName) return;
    const oldPath = `${localPath === '/' ? '' : localPath}/${oldName}`;
    const newPath = `${localPath === '/' ? '' : localPath}/${newName}`;
    try {
      await api.sftp.localRename(oldPath, newPath);
      toast.success(`Renamed ${oldName} to ${newName}`);
      loadLocalFiles(localPath);
    } catch (err: any) {
      toast.error(`Rename failed: ${err.message}`);
    }
  }

  // Local Delete
  async function handleDeleteLocal(name: string, isDir = false) {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return;
    const itemPath = `${localPath === '/' ? '' : localPath}/${name}`;
    try {
      await api.sftp.localDelete(itemPath, isDir ? 'directory' : 'file');
      toast.success(`Deleted ${name}`);
      loadLocalFiles(localPath);
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  }

  // Create Directory Remote
  async function handleMkdirRemote() {
    const dirName = prompt('Enter folder name:');
    if (!dirName) return;
    const fullPath = remotePath === '/' ? `/${dirName}` : `${remotePath}/${dirName}`;
    try {
      await api.sftp.mkdir(tab.connectionId, fullPath);
      toast.success(`Created folder ${dirName}`);
      addLog(`Command: mkdir "${fullPath}"`);
      loadRemoteFiles(remotePath);
    } catch (err: any) {
      toast.error(`Failed to create directory: ${err.message}`);
    }
  }

  // Rename Remote
  async function handleRenameRemote(oldName: string) {
    const newName = prompt('Enter new name:', oldName);
    if (!newName || newName === oldName) return;
    const oldPath = remotePath === '/' ? `/${oldName}` : `${remotePath}/${oldName}`;
    const newPath = remotePath === '/' ? `/${newName}` : `${remotePath}/${newName}`;
    try {
      await api.sftp.rename(tab.connectionId, oldPath, newPath);
      toast.success(`Renamed ${oldName} to ${newName}`);
      addLog(`Command: mv "${oldPath}" "${newPath}"`);
      loadRemoteFiles(remotePath);
    } catch (err: any) {
      toast.error(`Rename failed: ${err.message}`);
    }
  }

  // Delete Remote
  async function handleDeleteRemote(name: string, isDir = false) {
    if (!confirm(`Are you sure you want to delete ${name}?`)) return;
    const fullPath = remotePath === '/' ? `/${name}` : `${remotePath}/${name}`;
    try {
      await api.sftp.delete(tab.connectionId, fullPath, isDir ? 'directory' : 'file');
      toast.success(`Deleted ${name}`);
      addLog(`Command: rm "${fullPath}"`);
      loadRemoteFiles(remotePath);
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    }
  }

  // Direct upload files from file input
  async function handleDirectUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const toastId = toast.loading(`Uploading ${file.name}...`);
      addLog(`Command: put "${file.name}" to "${remotePath}"`);
      try {
        await api.sftp.upload(
          tab.connectionId,
          remotePath + (remotePath.endsWith('/') ? '' : '/') + file.name,
          file
        );
        toast.success(`Uploaded ${file.name}`, { id: toastId });
        addLog(`Status: File transfer successful, transferred ${formatSize(file.size)}`);
        setTransfers((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            direction: 'upload',
            status: 'success',
            time: new Date().toLocaleTimeString(),
          },
        ]);
      } catch (err: any) {
        addLog(`Error: Upload failed: ${err.message}`);
        toast.error(`Upload failed: ${err.message}`, { id: toastId });
      }
    }
    loadRemoteFiles(remotePath);
  }

  function handleOpenTerminal() {
    openTab({
      type: 'ssh',
      label: tab.connection?.name || 'SSH',
      connectionId: tab.connectionId,
      connection: tab.connection,
    });
    toast.success(`Opening SSH Terminal for ${tab.connection?.name || 'Session'}`);
  }

  const remoteFileCount = remoteFiles.filter((f) => f.type === 'file').length;
  const remoteDirCount = remoteFiles.filter((f) => f.type === 'directory').length;
  const remoteTotalBytes = remoteFiles.reduce((acc, f) => acc + (f.size || 0), 0);

  // Render Local Pane (Left Screen in Dual Pane mode)
  const renderLocalPane = () => (
    <div className="flex-1 h-full w-full flex flex-col bg-zinc-950 overflow-hidden">
      {/* Local Path Toolbar */}
      <div className="h-8 px-2.5 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <Laptop className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="text-[11px] font-mono text-zinc-400 font-semibold shrink-0">Local site:</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              loadLocalFiles(localPathInput);
            }}
            className="flex-1 min-w-[120px]"
          >
            <Input
              value={localPathInput}
              onChange={(e) => setLocalPathInput(e.target.value)}
              className="h-6 text-[11px] font-mono bg-zinc-950 border-zinc-800 text-zinc-200 px-2 py-0 truncate"
              placeholder="e.g. /home/pi/Downloads or C:\Users\..."
            />
          </form>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goUpLocal}
            disabled={!localParentPath}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Go up one local directory"
          >
            <ArrowUp className="w-3 h-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => loadLocalFiles('~')}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Local User Home Directory (~)"
          >
            <Home className="w-3 h-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => loadLocalFiles(localPath)}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Refresh Local Directory"
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Local Search filter */}
          <div className="relative flex items-center w-32 sm:w-40">
            <Search className="w-3 h-3 text-zinc-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              placeholder="Filter..."
              value={localSearchQuery}
              onChange={(e) => setLocalSearchQuery(e.target.value)}
              className="w-full h-6 pl-6 pr-5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/80 font-sans"
            />
            {localSearchQuery && (
              <button
                onClick={() => setLocalSearchQuery('')}
                className="absolute right-1.5 text-zinc-500 hover:text-zinc-300 p-0.5"
                title="Clear filter"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleMkdirLocal}
            className="h-6 px-2 text-[10px] border-zinc-800 text-zinc-300 hover:text-white gap-1"
            title="Create local directory"
          >
            <FolderPlus className="w-3 h-3" />
            <span>New Folder</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handlePickLocalBrowserFolder}
            className="h-6 px-2 text-[10px] border-zinc-800 text-zinc-300 hover:text-white gap-1"
            title="Pick a folder directly from your client PC"
          >
            <FolderOpen className="w-3 h-3 text-sky-400" />
            <span>Open PC Folder...</span>
          </Button>
        </div>
      </div>

      {/* Local File Table with Sticky Header, Sorting & Resizable Columns */}
      <div className="flex-1 overflow-auto min-h-0 relative w-full">
        {loadingLocal ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 font-mono">
            <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
            <p className="text-xs">Reading local directory listing...</p>
          </div>
        ) : (
          <div className="w-full min-w-full">
            <table
              className="w-full min-w-full caption-bottom text-sm border-collapse select-none"
              style={{
                minWidth: '100%',
                width: localColWidths.name
                  ? `${(localColWidths.name || 200) + localColWidths.size + localColWidths.type + localColWidths.modified}px`
                  : '100%',
              }}
            >
              <colgroup>
                <col className="w-auto" style={localColWidths.name ? { width: `${localColWidths.name}px` } : undefined} />
                <col style={{ width: `${localColWidths.size}px` }} />
                <col style={{ width: `${localColWidths.type}px` }} />
                <col style={{ width: `${localColWidths.modified}px` }} />
              </colgroup>
              <thead className="bg-zinc-900 sticky top-0 z-20 border-b border-zinc-800 select-none shadow-sm [&_tr]:border-b">
                <tr className="border-zinc-800 hover:bg-transparent">
                  <th
                    style={localColWidths.name ? { width: `${localColWidths.name}px` } : undefined}
                    onClick={() => handleLocalSort('name')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-left px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Filename"
                  >
                    <div className="flex items-center gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Filename</span>
                      {localSortKey === 'name' ? (
                        localSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('local', 'name', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                  <th
                    style={{ width: `${localColWidths.size}px` }}
                    onClick={() => handleLocalSort('size')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-right px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Filesize"
                  >
                    <div className="flex items-center justify-end gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Filesize</span>
                      {localSortKey === 'size' ? (
                        localSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('local', 'size', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                  <th
                    style={{ width: `${localColWidths.type}px` }}
                    onClick={() => handleLocalSort('type')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-left px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Filetype"
                  >
                    <div className="flex items-center gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Filetype</span>
                      {localSortKey === 'type' ? (
                        localSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('local', 'type', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                  <th
                    style={{ width: `${localColWidths.modified}px` }}
                    onClick={() => handleLocalSort('modified')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-right px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Last modified"
                  >
                    <div className="flex items-center justify-end gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Last modified</span>
                      {localSortKey === 'modified' ? (
                        localSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('local', 'modified', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {/* Parent Directory row (FileZilla '..') */}
                {localParentPath && (
                  <TableRow
                    onDoubleClick={goUpLocal}
                    className="border-zinc-800/60 cursor-pointer font-mono text-xs hover:bg-zinc-900/60 text-amber-400 select-none"
                  >
                    <TableCell className="px-2 py-1 align-middle">
                      <div className="flex items-center gap-2">
                        <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="font-bold text-amber-300">..</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-1 align-middle text-right text-zinc-600 text-xs font-mono">—</TableCell>
                    <TableCell className="px-2 py-1 align-middle text-left text-zinc-500 text-xs truncate">Parent directory</TableCell>
                    <TableCell className="px-2 py-1 align-middle text-right text-zinc-600 text-xs font-mono">—</TableCell>
                  </TableRow>
                )}

                {sortedAndFilteredLocalFiles.length === 0 && localSearchQuery && (
                  <TableRow>
                    <TableCell colSpan={4} className="h-28 text-center text-zinc-500 font-mono text-xs">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Search className="w-5 h-5 text-zinc-600" />
                        <span>No local files match &ldquo;{localSearchQuery}&rdquo;</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLocalSearchQuery('')}
                          className="h-6 px-2 text-xs border-zinc-800 text-zinc-300 hover:text-white"
                        >
                          Clear filter
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {sortedAndFilteredLocalFiles.map((file) => {
                  const isSelected = selectedLocal === file.name;
                  const isDir = file.type === 'directory';

                  return (
                    <TableRow
                      key={file.name}
                      onClick={() => setSelectedLocal(isSelected ? null : file.name)}
                      onDoubleClick={() => navigateLocal(file)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedLocal(file.name);
                        setLocalContextMenu({ x: e.clientX, y: e.clientY, item: file });
                      }}
                      className={`border-zinc-800/60 cursor-pointer font-mono text-xs transition-colors ${
                        isSelected
                          ? 'bg-zinc-800/90 text-white'
                          : 'hover:bg-zinc-900/40 text-zinc-300'
                      }`}
                    >
                      <TableCell className="px-2 py-1 align-middle">
                        <div className="flex items-center gap-2 truncate">
                          {isDir ? (
                            <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          )}
                          <span className={`truncate ${isDir ? 'font-medium text-zinc-100' : 'text-zinc-200'}`}>
                            {file.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-1 align-middle text-right text-zinc-400 text-xs font-mono truncate">
                        {isDir ? '—' : (file.size ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="px-2 py-1 align-middle text-left text-zinc-400 text-xs truncate">
                        {file.filetype || getFileType(file.name, isDir)}
                      </TableCell>
                      <TableCell className="px-2 py-1 align-middle text-right text-zinc-400 text-xs font-mono truncate">
                        {file.modifiedAt ? formatDate(file.modifiedAt) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Local Footer status (Fixed at bottom of pane) */}
      <div className="h-6 border-t border-zinc-800/80 bg-zinc-950 px-2.5 flex items-center justify-between text-[10px] font-mono text-zinc-400 shrink-0 select-none">
        <span>
          {localSearchQuery
            ? `${sortedAndFilteredLocalFiles.length} matched (${localStats?.fileCount ?? 0} files, ${localStats?.dirCount ?? 0} dirs)`
            : `${localStats?.fileCount ?? 0} files and ${localStats?.dirCount ?? 0} directories. Total size: ${(localStats?.totalBytes ?? 0).toLocaleString()} bytes`}
        </span>
        {selectedLocal && (
          <span className="text-emerald-400 truncate max-w-[200px]">
            Selected: {selectedLocal}
          </span>
        )}
      </div>
    </div>
  );

  // Render Remote Pane (Right Screen in Dual Pane mode or Full Screen in Single mode)
  const renderRemotePane = () => (
    <div className="flex-1 h-full w-full flex flex-col bg-zinc-950 overflow-hidden">
      {/* Remote Path Toolbar */}
      <div className="h-8 px-2.5 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <HardDrive className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="text-[11px] font-mono text-zinc-400 font-semibold shrink-0">Remote site:</span>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setRemotePath(remotePathInput);
            }}
            className="flex-1 min-w-[120px]"
          >
            <Input
              value={remotePathInput}
              onChange={(e) => setRemotePathInput(e.target.value)}
              className="h-6 text-[11px] font-mono bg-zinc-950 border-zinc-800 text-zinc-200 px-2 py-0 truncate"
            />
          </form>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={goUpRemote}
            disabled={remotePath === '/'}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Go up one remote directory"
          >
            <ArrowUp className="w-3 h-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setRemotePath('.')}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Go to Home directory (~)"
          >
            <Home className="w-3 h-3" />
          </Button>

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => loadRemoteFiles(remotePath)}
            className="text-zinc-400 hover:text-white h-6 w-6 shrink-0"
            title="Refresh Remote Directory"
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Remote Search Filter */}
          <div className="relative flex items-center w-36 sm:w-48">
            <Search className="w-3 h-3 text-zinc-500 absolute left-2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search in folder..."
              value={remoteSearchQuery}
              onChange={(e) => setRemoteSearchQuery(e.target.value)}
              className="w-full h-6 pl-6 pr-5 text-xs bg-zinc-950 border border-zinc-800 rounded text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500/80 font-sans"
            />
            {remoteSearchQuery && (
              <button
                onClick={() => setRemoteSearchQuery('')}
                className="absolute right-1.5 text-zinc-500 hover:text-zinc-300 p-0.5"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <input
            ref={directUploadRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) {
                handleDirectUploadFiles(e.target.files);
                e.target.value = '';
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => directUploadRef.current?.click()}
            className="border-emerald-700/50 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/40 hover:text-emerald-300 h-6 px-2 text-xs gap-1 font-sans"
            title="Upload files from your computer directly into this folder"
          >
            <Upload className="w-3 h-3" />
            <span>Upload</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleMkdirRemote}
            className="border-zinc-800 text-zinc-300 hover:text-white h-6 px-2 text-xs gap-1"
            title="Create Directory on Server"
          >
            <FolderPlus className="w-3 h-3" />
            <span>New Folder</span>
          </Button>
        </div>
      </div>

      {/* Remote File Table with Sticky Header, Sorting, Resizable Columns, and Direct Drag & Drop */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOverRemote(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOverRemote(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDraggingOverRemote(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleDirectUploadFiles(e.dataTransfer.files);
          }
        }}
        className="relative flex-1 overflow-auto min-h-0 w-full"
      >
        {isDraggingOverRemote && (
          <div className="absolute inset-0 z-30 bg-emerald-950/80 border-2 border-dashed border-emerald-400 flex flex-col items-center justify-center pointer-events-none backdrop-blur-xs animate-in fade-in">
            <Upload className="w-9 h-9 text-emerald-400 animate-bounce mb-2" />
            <p className="text-xs font-semibold text-emerald-100">Drop files to upload directly to server</p>
            <p className="text-[10px] text-emerald-300/80 font-mono">{remotePath}</p>
          </div>
        )}

        {loadingRemote ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-2 font-mono">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            <p className="text-xs">Reading remote directory listing...</p>
          </div>
        ) : (
          <div className="w-full min-w-full">
            <table
              className="w-full min-w-full caption-bottom text-sm border-collapse select-none"
              style={{
                minWidth: '100%',
                width: remoteColWidths.name
                  ? `${(remoteColWidths.name || 200) + remoteColWidths.size + remoteColWidths.type + remoteColWidths.modified + remoteColWidths.perm}px`
                  : '100%',
              }}
            >
              <colgroup>
                <col className="w-auto" style={remoteColWidths.name ? { width: `${remoteColWidths.name}px` } : undefined} />
                <col style={{ width: `${remoteColWidths.size}px` }} />
                <col style={{ width: `${remoteColWidths.type}px` }} />
                <col style={{ width: `${remoteColWidths.modified}px` }} />
                <col style={{ width: `${remoteColWidths.perm}px` }} />
              </colgroup>
              <thead className="bg-zinc-900 sticky top-0 z-20 border-b border-zinc-800 select-none shadow-sm [&_tr]:border-b">
                <tr className="border-zinc-800 hover:bg-transparent">
                  <th
                    style={remoteColWidths.name ? { width: `${remoteColWidths.name}px` } : undefined}
                    onClick={() => handleRemoteSort('name')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-left px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Filename"
                  >
                    <div className="flex items-center gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Filename</span>
                      {remoteSortKey === 'name' ? (
                        remoteSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('remote', 'name', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                  <th
                    style={{ width: `${remoteColWidths.size}px` }}
                    onClick={() => handleRemoteSort('size')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-right px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Filesize"
                  >
                    <div className="flex items-center justify-end gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Filesize</span>
                      {remoteSortKey === 'size' ? (
                        remoteSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('remote', 'size', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                  <th
                    style={{ width: `${remoteColWidths.type}px` }}
                    onClick={() => handleRemoteSort('type')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-left px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Filetype"
                  >
                    <div className="flex items-center gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Filetype</span>
                      {remoteSortKey === 'type' ? (
                        remoteSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('remote', 'type', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                  <th
                    style={{ width: `${remoteColWidths.modified}px` }}
                    onClick={() => handleRemoteSort('modified')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-right px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Last modified"
                  >
                    <div className="flex items-center justify-end gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Last modified</span>
                      {remoteSortKey === 'modified' ? (
                        remoteSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('remote', 'modified', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                  <th
                    style={{ width: `${remoteColWidths.perm}px` }}
                    onClick={() => handleRemoteSort('perm')}
                    className="text-zinc-400 font-semibold h-7 text-xs text-right px-2 relative group select-none cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
                    title="Sort by Permissions"
                  >
                    <div className="flex items-center justify-end gap-1.5 pr-3 overflow-hidden">
                      <span className="truncate">Permissions</span>
                      {remoteSortKey === 'perm' ? (
                        remoteSortOrder === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-sky-400 shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-sky-400 shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-2.5 h-2.5 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => startColResize('remote', 'perm', e)}
                      className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize z-30 flex items-center justify-center group-hover:bg-sky-500/20 active:bg-sky-500/40"
                    >
                      <div className="w-[2px] h-full bg-zinc-700 group-hover:bg-sky-400 transition-colors" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {/* Parent Directory row (FileZilla '..') */}
                {remotePath !== '/' && (
                  <TableRow
                    onDoubleClick={goUpRemote}
                    className="border-zinc-800/60 cursor-pointer font-mono text-xs hover:bg-zinc-900/60 text-amber-400 select-none"
                  >
                    <TableCell className="px-2 py-1 align-middle">
                      <div className="flex items-center gap-2">
                        <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        <span className="font-bold text-amber-300">..</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-1 align-middle text-right text-zinc-600 text-xs font-mono">—</TableCell>
                    <TableCell className="px-2 py-1 align-middle text-left text-zinc-500 text-xs truncate">Parent directory</TableCell>
                    <TableCell className="px-2 py-1 align-middle text-right text-zinc-600 text-xs font-mono">—</TableCell>
                    <TableCell className="px-2 py-1 align-middle text-right text-zinc-600 text-xs font-mono">—</TableCell>
                  </TableRow>
                )}

                {sortedAndFilteredRemoteFiles.length === 0 && remoteSearchQuery && (
                  <TableRow>
                    <TableCell colSpan={5} className="h-28 text-center text-zinc-500 font-mono text-xs">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Search className="w-5 h-5 text-zinc-600" />
                        <span>No files or folders match &ldquo;{remoteSearchQuery}&rdquo;</span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRemoteSearchQuery('')}
                          className="h-6 px-2 text-xs border-zinc-800 text-zinc-300 hover:text-white"
                        >
                          Clear filter
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )}

                {sortedAndFilteredRemoteFiles.map((file) => {
                  const isSelected = selectedRemote === file.name;
                  const isDir = file.type === 'directory';

                  return (
                    <TableRow
                      key={file.name}
                      onClick={() => setSelectedRemote(isSelected ? null : file.name)}
                      onDoubleClick={() => navigateRemote(file)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setSelectedRemote(file.name);
                        setRemoteContextMenu({ x: e.clientX, y: e.clientY, item: file });
                      }}
                      className={`border-zinc-800/60 cursor-pointer font-mono text-xs transition-colors ${
                        isSelected
                          ? 'bg-zinc-800/90 text-white'
                          : 'hover:bg-zinc-900/40 text-zinc-300'
                      }`}
                    >
                      <TableCell className="px-2 py-1 align-middle">
                        <div className="flex items-center gap-2 truncate">
                          {isDir ? (
                            <Folder className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          ) : (
                            <File className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                          )}
                          <span className={`truncate ${isDir ? 'font-medium text-zinc-100' : 'text-zinc-200'}`}>
                            {file.name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="px-2 py-1 align-middle text-right text-zinc-400 text-xs font-mono truncate">
                        {isDir ? '—' : (file.size || 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="px-2 py-1 align-middle text-left text-zinc-400 text-xs truncate">
                        {getFileType(file.name, isDir)}
                      </TableCell>
                      <TableCell className="px-2 py-1 align-middle text-right text-zinc-400 text-xs font-mono truncate">
                        {file.modifiedAt ? formatDate(file.modifiedAt) : '—'}
                      </TableCell>
                      <TableCell className="px-2 py-1 align-middle text-right text-zinc-500 text-xs font-mono truncate">
                        {formatPermissions(file.permissions)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Remote Footer status (Fixed at bottom of pane) */}
      <div className="h-6 border-t border-zinc-800/80 bg-zinc-950 px-2.5 flex items-center justify-between text-[10px] font-mono text-zinc-400 shrink-0 select-none">
        <span>
          {remoteSearchQuery
            ? `${sortedAndFilteredRemoteFiles.length} matched (${remoteFileCount ?? 0} files, ${remoteDirCount ?? 0} dirs)`
            : `${remoteFileCount ?? 0} files and ${remoteDirCount ?? 0} directories. Total size: ${(remoteTotalBytes ?? 0).toLocaleString()} bytes`}
        </span>
        {selectedRemote && (
          <span className="text-amber-400 truncate max-w-[260px]">
            Selected: {selectedRemote}
          </span>
        )}
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-200 select-none overflow-hidden relative">
      {/* Top Header Bar */}
      <div className="h-9 px-3 border-b border-zinc-800 flex items-center justify-between shrink-0 bg-zinc-950">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-amber-400 border-amber-500/30 gap-1 text-[11px] h-5 px-1.5 font-mono">
            <Folder className="w-3 h-3 text-amber-400" />
            <span>SFTP</span>
          </Badge>
          <span className="text-xs font-mono text-zinc-400">
            sftp://{tab.connection?.username || 'user'}@{tab.connection?.host || 'localhost'}:{tab.connection?.port || 22}
          </span>
        </div>

        {/* View Layout Toggle: Single Pane (Default) vs Dual Pane (FileZilla) */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5">
            <button
              onClick={() => setPaneMode('single')}
              className={`h-5 px-2 text-[11px] rounded flex items-center gap-1 transition-colors ${
                paneMode === 'single'
                  ? 'bg-zinc-800 text-sky-400 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Single Screen View (Remote Explorer, optimal full width)"
            >
              <Square className="w-3 h-3" />
              <span>Single</span>
            </button>
            <button
              onClick={() => setPaneMode('dual')}
              className={`h-5 px-2 text-[11px] rounded flex items-center gap-1 transition-colors ${
                paneMode === 'dual'
                  ? 'bg-zinc-800 text-sky-400 font-semibold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
              title="Dual-Pane View (Side-by-side Local site & Remote server)"
            >
              <Columns2 className="w-3 h-3" />
              <span>Dual Pane</span>
            </button>
          </div>

          {/* Transfer Action Controls in Header (Only when Dual-Pane is active) */}
          {paneMode === 'dual' && (
            <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleUploadLocalFile()}
                disabled={!selectedLocal}
                className={`h-5 px-2 text-[11px] gap-1 ${selectedLocal ? 'text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40' : 'text-zinc-600'}`}
                title="Upload selected local file to server"
              >
                <ArrowRight className="w-3 h-3" />
                <span>Upload &rarr;</span>
              </Button>

              <Separator orientation="vertical" className="h-3 bg-zinc-800" />

              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleDownloadToLocal()}
                disabled={!selectedRemote}
                className={`h-5 px-2 text-[11px] gap-1 ${selectedRemote ? 'text-sky-400 hover:text-sky-300 hover:bg-sky-950/40' : 'text-zinc-600'}`}
                title="Download selected remote file to local directory"
              >
                <ArrowLeft className="w-3 h-3" />
                <span>&larr; Download</span>
              </Button>
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleOpenTerminal}
            className="h-6 px-2 text-[11px] border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-emerald-400 hover:text-emerald-300 gap-1 font-sans"
            title="Open an interactive terminal tab to this server"
          >
            <Terminal className="w-3 h-3" />
            <span>Terminal</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLog(!showLog)}
            className="h-6 px-2 text-[11px] text-zinc-400 hover:text-white"
          >
            {showLog ? 'Hide Log' : 'Show Log'}
          </Button>
        </div>
      </div>

      {/* Top FileZilla Command / Response Log Area */}
      {showLog && (
        <>
          <div
            ref={logContainerRef}
            style={{ height: `${logHeight}px` }}
            className="bg-black/90 border-b border-zinc-800 px-3 py-1 font-mono text-[10px] text-zinc-300 overflow-y-auto shrink-0 select-text leading-snug space-y-0.5"
          >
            {logs.map((log, index) => {
              const isCommand = log.startsWith('Command:');
              const isError = log.startsWith('Error:');
              const isSuccess = log.includes('successful') || log.includes('transferred');
              return (
                <div
                  key={index}
                  className={`truncate ${
                    isError
                      ? 'text-rose-400'
                      : isCommand
                      ? 'text-cyan-400'
                      : isSuccess
                      ? 'text-zinc-400'
                      : 'text-zinc-400'
                  }`}
                >
                  {log}
                </div>
              );
            })}
          </div>

          {/* Resizable Divider Handle for Log */}
          <div
            onMouseDown={handleMouseDownLog}
            className={`h-1 bg-zinc-800 hover:bg-sky-500 cursor-row-resize transition-colors shrink-0 ${
              isDraggingLog ? 'bg-sky-500' : ''
            }`}
          />
        </>
      )}

      {/* Main Workspace View: Single Pane (Default) vs Dual-Pane */}
      <div className="flex-1 flex overflow-hidden">
        {paneMode === 'dual' ? (
          <ResizablePanelGroup direction="horizontal" className="flex-1 h-full w-full">
            <ResizablePanel defaultSize={50} minSize={20} className="flex flex-col bg-zinc-950 border-r border-zinc-800/60 overflow-hidden">
              {renderLocalPane()}
            </ResizablePanel>
            <ResizableHandle withHandle className="bg-zinc-800 hover:bg-zinc-600 transition-colors" />
            <ResizablePanel defaultSize={50} minSize={20} className="flex flex-col bg-zinc-950 overflow-hidden">
              {renderRemotePane()}
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex-1 h-full w-full flex flex-col bg-zinc-950 overflow-hidden">
            {renderRemotePane()}
          </div>
        )}
      </div>

      {/* Native Context Menu for Local Pane */}
      {localContextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setLocalContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setLocalContextMenu(null);
            }}
          />
          <div
            style={{ top: `${localContextMenu.y}px`, left: `${localContextMenu.x}px` }}
            className="fixed z-50 min-w-[180px] bg-zinc-900 border border-zinc-800 rounded-md shadow-2xl py-1 text-xs font-sans text-zinc-300 animate-in fade-in-50 zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 py-1 text-[10px] text-zinc-500 font-mono truncate border-b border-zinc-800/80 mb-1">
              {localContextMenu.item.name}
            </div>

            {localContextMenu.item.type === 'file' && (
              <>
                {canPreviewFile(localContextMenu.item.name) && (
                  <button
                    onClick={() => {
                      const name = localContextMenu.item.name;
                      setLocalContextMenu(null);
                      handlePreviewFile(name, true);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-emerald-400 hover:bg-emerald-950/40 hover:text-emerald-300 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Quick View</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    const item = localContextMenu.item;
                    setLocalContextMenu(null);
                    handleUploadLocalFile(item);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-sky-400 hover:bg-sky-950/40 hover:text-sky-300 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload to Server</span>
                </button>
              </>
            )}

            <button
              onClick={() => {
                const name = localContextMenu.item.name;
                setLocalContextMenu(null);
                handleRenameLocal(name);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Rename
            </button>

            <button
              onClick={() => {
                const name = localContextMenu.item.name;
                const path = localContextMenu.item.path || `${localPath}/${name}`;
                setLocalContextMenu(null);
                navigator.clipboard.writeText(path);
                toast.success('Local path copied to clipboard');
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Local Path
            </button>

            <div className="h-px bg-zinc-800/80 my-1" />

            <button
              onClick={() => {
                const name = localContextMenu.item.name;
                const isDir = localContextMenu.item.type === 'directory';
                setLocalContextMenu(null);
                handleDeleteLocal(name, isDir);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Local Item
            </button>
          </div>
        </>
      )}

      {/* Native Context Menu for Remote Pane */}
      {remoteContextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setRemoteContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setRemoteContextMenu(null);
            }}
          />
          <div
            style={{ top: `${remoteContextMenu.y}px`, left: `${remoteContextMenu.x}px` }}
            className="fixed z-50 min-w-[190px] bg-zinc-900 border border-zinc-800 rounded-md shadow-2xl py-1 text-xs font-sans text-zinc-300 animate-in fade-in-50 zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-2.5 py-1 text-[10px] text-zinc-500 font-mono truncate border-b border-zinc-800/80 mb-1">
              {remoteContextMenu.item.name}
            </div>

            {remoteContextMenu.item.type === 'file' ? (
              <>
                {canPreviewFile(remoteContextMenu.item.name) && (
                  <button
                    onClick={() => {
                      const name = remoteContextMenu.item.name;
                      setRemoteContextMenu(null);
                      handlePreviewFile(name, false);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-emerald-400 hover:bg-emerald-950/40 hover:text-emerald-300 transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Quick View</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    const name = remoteContextMenu.item.name;
                    setRemoteContextMenu(null);
                    handleDownloadFile(name);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-sky-400 hover:bg-sky-950/40 hover:text-sky-300 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </button>

                {paneMode === 'dual' && (
                  <button
                    onClick={() => {
                      const name = remoteContextMenu.item.name;
                      setRemoteContextMenu(null);
                      handleDownloadToLocal(name);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Download to Local site</span>
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setRemoteContextMenu(null);
                    navigateRemote(remoteContextMenu.item);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-sky-400 hover:bg-sky-950/40 hover:text-sky-300 transition-colors"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Open Folder</span>
                </button>

                {paneMode === 'dual' && (
                  <button
                    onClick={() => {
                      const name = remoteContextMenu.item.name;
                      setRemoteContextMenu(null);
                      handleDownloadToLocal(name);
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-emerald-400 hover:bg-emerald-950/40 hover:text-emerald-300 transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Download to Local site</span>
                  </button>
                )}
              </>
            )}

            <button
              onClick={() => {
                const name = remoteContextMenu.item.name;
                setRemoteContextMenu(null);
                handleRenameRemote(name);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Rename
            </button>

            <button
              onClick={() => {
                const name = remoteContextMenu.item.name;
                setRemoteContextMenu(null);
                const fullPath = `${remotePath === '/' ? '' : remotePath}/${name}`;
                navigator.clipboard.writeText(fullPath);
                toast.success('Path copied to clipboard');
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy Remote Path
            </button>

            <div className="h-px bg-zinc-800/80 my-1" />

            <button
              onClick={() => {
                const name = remoteContextMenu.item.name;
                const isDir = remoteContextMenu.item.type === 'directory';
                setRemoteContextMenu(null);
                handleDeleteRemote(name, isDir);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-left text-rose-400 hover:bg-rose-950/40 hover:text-rose-300 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete from Server
            </button>
          </div>
        </>
      )}

      {/* FileZilla Bottom Transfer Queue / Status Strip */}
      <div className="h-6 border-t border-zinc-800 bg-zinc-950 px-3 flex items-center justify-between text-[11px] font-mono text-zinc-500 shrink-0 select-none">
        <div className="flex items-center gap-3">
          <span className="hover:text-zinc-300 cursor-pointer">Queued files (0)</span>
          <Separator orientation="vertical" className="h-3 bg-zinc-800" />
          <span
            onClick={() => setShowTransferDrawer(!showTransferDrawer)}
            className="hover:text-emerald-300 cursor-pointer text-emerald-400 flex items-center gap-1"
            title="Click to view transfer history"
          >
            Successful transfers ({transfers.filter((t) => t.status === 'success').length})
          </span>
          <Separator orientation="vertical" className="h-3 bg-zinc-800" />
          <span
            onClick={() => setShowTransferDrawer(!showTransferDrawer)}
            className="hover:text-rose-300 cursor-pointer text-rose-400"
            title="Click to view transfer history"
          >
            Failed transfers ({transfers.filter((t) => t.status === 'failed').length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span>FileZilla Dual-Pane Mode</span>
        </div>
      </div>

      {/* Transfer History Drawer */}
      {showTransferDrawer && (
        <div className="h-32 border-t border-zinc-800 bg-zinc-950 p-2 font-mono text-xs overflow-y-auto shrink-0 select-text">
          <div className="flex items-center justify-between pb-1 mb-1 border-b border-zinc-800 text-[10px] text-zinc-400">
            <span>Transfer History</span>
            <button onClick={() => setShowTransferDrawer(false)} className="hover:text-white">Close &times;</button>
          </div>
          {transfers.length === 0 ? (
            <div className="text-zinc-600 text-center py-4">No recent transfers.</div>
          ) : (
            <div className="space-y-1">
              {transfers.map((t, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] text-zinc-300">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[9px] h-4 px-1 ${t.direction === 'upload' ? 'text-emerald-400 border-emerald-500/30' : 'text-sky-400 border-sky-500/30'}`}>
                      {t.direction === 'upload' ? 'Upload &rarr;' : '&larr; Download'}
                    </Badge>
                    <span className="font-semibold">{t.name}</span>
                    <span className="text-zinc-500">({formatSize(t.size)})</span>
                  </div>
                  <div className="flex items-center gap-3 text-zinc-500 text-[10px]">
                    <span className={t.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}>{t.status}</span>
                    <span>{t.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Live Preview Modal for CSV, Text, and Archive Files */}
      {previewModal.isOpen && (
        <FilePreviewModal
          isOpen={previewModal.isOpen}
          onClose={() => setPreviewModal({ isOpen: false, filePath: '', fileName: '', isLocal: false })}
          connectionId={tab.connectionId}
          filePath={previewModal.filePath}
          fileName={previewModal.fileName}
          isLocal={previewModal.isLocal}
        />
      )}
    </div>
  );
}
