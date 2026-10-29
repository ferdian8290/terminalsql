import { useState } from 'react';
import { Plus, Terminal, Database, FolderOpen, Trash2, ChevronRight, ArrowUpDown, Loader2, Zap } from 'lucide-react';
import { useAppStore, Connection } from '@/store/appStore';
import { api } from '@/utils/api';
import toast from 'react-hot-toast';
import { NewConnectionModal } from './NewConnectionModal';
import { ImportExportModal } from './ImportExportModal';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

const TYPE_CONFIG = {
  ssh: {
    icon: Terminal,
    label: 'SSH Terminal',
    badgeClass: 'border-emerald-500/30 text-emerald-400 bg-emerald-950/30',
    iconBg: 'bg-zinc-800 text-emerald-400 border border-zinc-700/80',
  },
  database: {
    icon: Database,
    label: 'Database',
    badgeClass: 'border-purple-500/30 text-purple-400 bg-purple-950/30',
    iconBg: 'bg-zinc-800 text-purple-400 border border-zinc-700/80',
  },
  sftp: {
    icon: FolderOpen,
    label: 'SFTP File Manager',
    badgeClass: 'border-amber-500/30 text-amber-400 bg-amber-950/30',
    iconBg: 'bg-zinc-800 text-amber-400 border border-zinc-700/80',
  },
};

export function ConnectionManager() {
  const { connections, removeConnection, openTab } = useAppStore();
  const [showModal, setShowModal] = useState(false);
  const [showImportExport, setShowImportExport] = useState(false);
  const [filter, setFilter] = useState<'all' | 'ssh' | 'database' | 'sftp'>('all');
  const [testing, setTesting] = useState<string | null>(null);

  const filtered = filter === 'all' ? connections : connections.filter((c) => c.type === filter);

  async function handleConnect(conn: Connection) {
    openTab({
      type: conn.type,
      label: conn.name,
      connectionId: conn.id,
      connection: conn,
    });
    toast.success(`Opening ${conn.name}...`);
  }

  async function handleTest(conn: Connection, e: React.MouseEvent) {
    e.stopPropagation();
    setTesting(conn.id);
    try {
      const result = await api.connections.test(conn.id);
      if (result.success) toast.success(result.message);
      else toast.error(result.message);
    } catch (err: any) {
      toast.error(err.message || 'Connection test failed');
    } finally {
      setTesting(null);
    }
  }

  async function handleDelete(conn: Connection, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`Delete connection "${conn.name}"?`)) return;
    try {
      await api.connections.delete(conn.id);
      removeConnection(conn.id);
      toast.success('Connection deleted');
    } catch (err: any) {
      toast.error(err.message);
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Top Filter and Actions Toolbar */}
      <div className="px-5 py-2.5 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-4 shrink-0">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as any)}>
          <TabsList className="bg-zinc-900 border border-zinc-800 h-8 p-0.5">
            <TabsTrigger value="all" className="text-xs h-7 data-[state=active]:bg-zinc-800 data-[state=active]:text-white">
              All ({connections.length})
            </TabsTrigger>
            <TabsTrigger value="ssh" className="text-xs h-7 data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              SSH ({connections.filter((c) => c.type === 'ssh').length})
            </TabsTrigger>
            <TabsTrigger value="database" className="text-xs h-7 data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-purple-400" />
              Database ({connections.filter((c) => c.type === 'database').length})
            </TabsTrigger>
            <TabsTrigger value="sftp" className="text-xs h-7 data-[state=active]:bg-zinc-800 data-[state=active]:text-white flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
              SFTP ({connections.filter((c) => c.type === 'sftp').length})
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowImportExport(true)}
            className="border-zinc-800 text-zinc-300 hover:text-white text-xs h-8 px-2.5 gap-1.5"
            title="Import / Export Connections"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-zinc-400" />
            Import / Export
          </Button>

          <Button
            onClick={() => setShowModal(true)}
            className="bg-white hover:bg-zinc-200 text-zinc-950 font-medium text-xs h-8 px-3 gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Connection
          </Button>
        </div>
      </div>

      {/* Main Grid / Empty State */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 max-w-sm mx-auto space-y-3">
            <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-500 shadow-sm">
              <Plus className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-zinc-200">No connections</h3>
              <p className="text-xs text-zinc-400">
                {filter === 'all'
                  ? 'Add your first SSH server, Database, or SFTP host to get started.'
                  : `No ${filter.toUpperCase()} connections match your active filter.`}
              </p>
            </div>
            <Button
              onClick={() => setShowModal(true)}
              className="bg-white hover:bg-zinc-200 text-zinc-950 font-medium text-xs h-8 gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((conn) => {
              const cfg = TYPE_CONFIG[conn.type];
              const Icon = cfg.icon;

              return (
                <Card
                  key={conn.id}
                  onDoubleClick={() => handleConnect(conn)}
                  className="bg-zinc-900/40 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/80 transition-all duration-150 cursor-pointer group shadow-sm flex flex-col justify-between rounded-xl"
                >
                  <CardHeader className="p-4 pb-2.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cfg.iconBg}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <CardTitle className="text-xs font-semibold text-zinc-100 truncate group-hover:text-white transition-colors">
                            {conn.name}
                          </CardTitle>
                          <p className="text-[11px] font-mono text-zinc-400 truncate">
                            {conn.host}:{conn.port}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 font-medium ${cfg.badgeClass}`}>
                        {conn.type.toUpperCase()}
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="px-4 py-1 space-y-2 text-xs">
                    <div className="text-[11px] font-mono text-zinc-400 truncate bg-zinc-950 px-2 py-1 rounded border border-zinc-800/80">
                      {conn.username}@{conn.host}
                    </div>

                    {conn.tags && conn.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-0.5">
                        {conn.tags.map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 font-mono"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </CardContent>

                  <CardFooter className="p-4 pt-2.5 flex items-center gap-2 border-t border-zinc-800/60 mt-3">
                    <Button
                      size="sm"
                      onClick={() => handleConnect(conn)}
                      className="flex-1 bg-zinc-800 hover:bg-white hover:text-zinc-950 text-zinc-200 text-xs font-medium h-8 transition-colors gap-1"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                      Connect
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => handleTest(conn, e)}
                      disabled={testing === conn.id}
                      className="text-zinc-400 hover:text-white hover:bg-zinc-800 h-8 w-8"
                      title="Test Connection"
                    >
                      {testing === conn.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-300" />
                      ) : (
                        <Zap className="w-3.5 h-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={(e) => handleDelete(conn, e)}
                      className="text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 h-8 w-8"
                      title="Delete Connection"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {showModal && <NewConnectionModal onClose={() => setShowModal(false)} />}
      {showImportExport && <ImportExportModal onClose={() => setShowImportExport(false)} />}
    </div>
  );
}
