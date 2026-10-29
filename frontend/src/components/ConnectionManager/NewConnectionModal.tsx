import { useEffect, useState } from 'react';
import { api } from '@/utils/api';
import { useAppStore, Connection } from '@/store/appStore';
import toast from 'react-hot-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Terminal, Database, FolderOpen, Loader2, Eye, EyeOff,
  CheckCircle2, AlertCircle, ShieldCheck, Zap, Network, Server, Edit3
} from 'lucide-react';
import { ClickHouseIcon, PostgresIcon, MySQLIcon, SQLiteIcon } from '@/components/common/DatabaseBrandIcons';

type ConnType = 'ssh' | 'database' | 'sftp';
type DbType = 'mysql' | 'postgres' | 'sqlite' | 'clickhouse';

const DEFAULT_PORTS: Record<ConnType, number> = { ssh: 22, database: 3306, sftp: 22 };

export function NewConnectionModal({
  onClose,
  editConnection,
  initialFolder,
}: {
  onClose: () => void;
  editConnection?: Connection | null;
  initialFolder?: string;
}) {
  const { addConnection, updateConnection, connections } = useAppStore();
  const sshConnections = connections.filter((c) => c.type === 'ssh');
  const existingFolders = Array.from(
    new Set(connections.map((c) => c.folder).filter(Boolean) as string[])
  );

  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; durationMs?: number } | null>(null);

  const [type, setType] = useState<ConnType>('ssh');
  const [dbType, setDbType] = useState<DbType>('mysql');
  const [showPassword, setShowPassword] = useState(false);
  const [showDbPassword, setShowDbPassword] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showBastionPassword, setShowBastionPassword] = useState(false);

  const [form, setForm] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    folder: initialFolder || '',
    password: '',
    privateKey: '',
    passphrase: '',
    database: '',
    dbPassword: '',
    ssl: false,
    tags: '',
    color: '#00d4ff',

    // Jump Host / Bastion
    useBastion: false,
    bastionMode: sshConnections.length > 0 ? ('reuse' as 'reuse' | 'custom') : ('custom' as 'reuse' | 'custom'),
    bastionReuseId: sshConnections[0]?.id || '',
    bastionHost: '',
    bastionPort: 22,
    bastionUsername: '',
    bastionAuthType: 'password' as 'password' | 'key',
    bastionPassword: '',
    bastionPrivateKey: '',
    bastionPassphrase: '',
  });

  useEffect(() => {
    if (!editConnection) return;
    setLoading(true);
    api.connections.get(editConnection.id).then((res) => {
      const c = res.connection;
      if (!c) return;
      setType(c.type);
      const creds = c.credentials || {};
      const inferredDbType: DbType = creds.dbType || (
        c.port === 9443 || c.name.toLowerCase().includes('clickhouse')
          ? 'clickhouse'
          : c.port === 5432
          ? 'postgres'
          : c.port === 0
          ? 'sqlite'
          : 'mysql'
      );
      setDbType(inferredDbType);
      setForm({
        name: c.name || '',
        host: c.host || '',
        port: c.port || (c.type === 'database' ? 3306 : 22),
        username: c.username || '',
        folder: c.folder || '',
        password: creds.password || '',
        privateKey: creds.privateKey || '',
        passphrase: creds.passphrase || '',
        database: creds.database || '',
        dbPassword: creds.dbPassword || '',
        ssl: creds.ssl ?? false,
        tags: (c.tags || []).join(', '),
        color: c.color || '#00d4ff',

        useBastion: creds.useBastion || false,
        bastionMode: creds.bastion?.reuseConnectionId ? 'reuse' : 'custom',
        bastionReuseId: creds.bastion?.reuseConnectionId || (sshConnections[0]?.id || ''),
        bastionHost: creds.bastion?.host || '',
        bastionPort: creds.bastion?.port || 22,
        bastionUsername: creds.bastion?.username || '',
        bastionAuthType: creds.bastion?.authType || 'password',
        bastionPassword: creds.bastion?.password || '',
        bastionPrivateKey: creds.bastion?.privateKey || '',
        bastionPassphrase: creds.bastion?.passphrase || '',
      });
    }).catch((err) => {
      toast.error('Failed to load connection details: ' + err.message);
    }).finally(() => {
      setLoading(false);
    });
  }, [editConnection?.id]);

  function set(key: string, val: any) {
    setForm((f) => ({ ...f, [key]: val }));
    setTestResult(null);
  }

  function handleTypeChange(t: ConnType) {
    setType(t);
    setTestResult(null);
    if (t === 'database') {
      applyDbDefaults(dbType);
    } else {
      set('port', DEFAULT_PORTS[t]);
    }
  }

  function applyDbDefaults(engine: DbType) {
    setDbType(engine);
    setTestResult(null);
    if (engine === 'mysql') {
      set('port', 3306);
      if (!form.username) set('username', 'root');
    } else if (engine === 'postgres') {
      set('port', 5432);
      if (!form.username) set('username', 'postgres');
      if (!form.database) set('database', 'postgres');
    } else if (engine === 'clickhouse') {
      set('port', 9443);
      set('ssl', true);
      if (!form.username) set('username', 'default');
      if (!form.database) set('database', 'default');
    } else if (engine === 'sqlite') {
      set('port', 0);
      set('host', 'localhost');
      set('username', 'sqlite');
      if (!form.database) set('database', '/home/pi/zabbixboy/terminalsql/backend/data/terminalsql.db');
    }
  }

  function buildCredentials() {
    const isSqlite = type === 'database' && dbType === 'sqlite';

    const baseCreds: Record<string, any> =
      type === 'database'
        ? {
            dbPassword: isSqlite ? undefined : form.dbPassword,
            database: form.database,
            dbType,
            ssl: isSqlite ? false : form.ssl,
          }
        : {
            password: form.password,
            privateKey: form.privateKey || undefined,
            passphrase: form.passphrase || undefined,
          };

    if (form.useBastion) {
      baseCreds.useBastion = true;
      baseCreds.bastion =
        form.bastionMode === 'reuse' && form.bastionReuseId
          ? { reuseConnectionId: form.bastionReuseId }
          : {
              host: form.bastionHost,
              port: Number(form.bastionPort) || 22,
              username: form.bastionUsername,
              authType: form.bastionAuthType,
              password: form.bastionPassword,
              privateKey: form.bastionPrivateKey || undefined,
              passphrase: form.bastionPassphrase || undefined,
            };
    }

    return baseCreds;
  }

  async function handleTestConnection() {
    if (!form.host && !(type === 'database' && dbType === 'sqlite' && form.database)) {
      toast.error('Please enter host/server address first');
      return;
    }

    if (form.useBastion) {
      if (form.bastionMode === 'reuse' && !form.bastionReuseId) {
        toast.error('Please select a saved Jump Host');
        return;
      }
      if (form.bastionMode === 'custom' && (!form.bastionHost || !form.bastionUsername)) {
        toast.error('Please enter Jump Host address and username');
        return;
      }
    }

    setTesting(true);
    setTestResult(null);

    try {
      const isSqlite = type === 'database' && dbType === 'sqlite';
      const credentials = buildCredentials();

      const res = await api.connections.testRaw({
        type,
        host: isSqlite ? form.database : form.host,
        port: isSqlite ? 0 : Number(form.port) || 0,
        username: isSqlite ? 'sqlite' : form.username,
        credentials,
      });

      setTestResult(res);
      if (res.success) {
        toast.success(res.message);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      const msg = err.message || 'Connection test failed';
      setTestResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.useBastion) {
      if (form.bastionMode === 'reuse' && !form.bastionReuseId) {
        toast.error('Please select a saved Jump Host');
        return;
      }
      if (form.bastionMode === 'custom' && (!form.bastionHost || !form.bastionUsername)) {
        toast.error('Please fill in Jump Host details');
        return;
      }
    }

    setLoading(true);
    try {
      const isSqlite = type === 'database' && dbType === 'sqlite';
      const credentials = buildCredentials();

      if (editConnection) {
        const res: any = await api.connections.update(editConnection.id, {
          name: form.name.trim() || form.host,
          type,
          host: isSqlite ? form.database : form.host,
          port: isSqlite ? 0 : Number(form.port),
          username: isSqlite ? 'sqlite' : form.username,
          folder: form.folder ? form.folder.trim() : null,
          credentials,
          tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
          color: form.color,
        });

        if (res.connection) {
          updateConnection(res.connection);
        } else {
          updateConnection({
            id: editConnection.id,
            name: form.name.trim() || form.host,
            type,
            host: isSqlite ? form.database : form.host,
            port: isSqlite ? 0 : Number(form.port),
            username: isSqlite ? 'sqlite' : form.username,
            folder: form.folder ? form.folder.trim() : null,
            tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
            color: form.color,
          });
        }
        toast.success('Connection updated successfully');
        onClose();
      } else {
        const res: any = await api.connections.create({
          name: form.name.trim() || form.host,
          type,
          host: isSqlite ? form.database : form.host,
          port: isSqlite ? 0 : Number(form.port),
          username: isSqlite ? 'sqlite' : form.username,
          folder: form.folder ? form.folder.trim() : null,
          credentials,
          tags: form.tags ? form.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
          color: form.color,
        });

        addConnection(res.connection);
        toast.success('Connection created successfully');
        onClose();
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to save connection');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 sm:max-w-[780px] md:max-w-[840px] max-h-[92vh] overflow-y-auto p-5 font-sans shadow-2xl">
        <DialogHeader className="pr-8 pb-2 border-b border-zinc-800/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-700/70 flex items-center justify-center text-white shadow-sm">
                {editConnection ? <Edit3 className="w-4 h-4 text-amber-400" /> : <Zap className="w-4 h-4 text-emerald-400" />}
              </div>
              <div>
                <DialogTitle className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
                  {editConnection ? `Edit: ${editConnection.name}` : 'New Connection'}
                  <Badge variant="outline" className="text-[10px] font-mono border-zinc-800 bg-zinc-900 text-zinc-400">
                    AES-256 GCM
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-zinc-400 mt-0.5">
                  Configure SSH, Database, or SFTP host credentials with optional Jump Host (Bastion) tunneling.
                </DialogDescription>
              </div>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* Protocol Selection Switcher */}
          <div className="grid grid-cols-3 gap-2 p-1 bg-zinc-900/60 rounded-lg border border-zinc-800/80">
            <button
              type="button"
              onClick={() => handleTypeChange('ssh')}
              className={`flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
                type === 'ssh'
                  ? 'bg-zinc-800 text-emerald-400 border border-zinc-700 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>SSH Terminal</span>
            </button>

            <button
              type="button"
              onClick={() => handleTypeChange('database')}
              className={`flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
                type === 'database'
                  ? 'bg-zinc-800 text-purple-400 border border-zinc-700 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Database (SQL)</span>
            </button>

            <button
              type="button"
              onClick={() => handleTypeChange('sftp')}
              className={`flex items-center justify-center gap-2 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${
                type === 'sftp'
                  ? 'bg-zinc-800 text-amber-400 border border-zinc-700 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-850'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>SFTP Browser</span>
            </button>
          </div>

          {/* Landscape 2-Column Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* LEFT COLUMN: Connection Identification & Network */}
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="conn-name" className="text-[11px] text-zinc-300 font-medium">
                  Connection Label *
                </Label>
                <Input
                  id="conn-name"
                  placeholder={type === 'database' ? 'e.g. Redhat (NDM-SL)' : 'e.g. Production Web 01'}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  required
                  className="bg-zinc-950 border-zinc-800 text-zinc-100 text-xs h-8 focus:border-zinc-500"
                />
              </div>

              {/* Folder / Group Selector */}
              <div className="space-y-1">
                <Label htmlFor="conn-folder" className="text-[11px] text-zinc-300 font-medium flex items-center justify-between">
                  <span>Folder / Group (Optional)</span>
                  {form.folder && (
                    <button
                      type="button"
                      onClick={() => set('folder', '')}
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </Label>
                <div className="relative">
                  <Input
                    id="conn-folder"
                    placeholder="e.g. Production, Telkomsel, Staging"
                    value={form.folder}
                    onChange={(e) => set('folder', e.target.value)}
                    list="existing-folders-datalist"
                    className="bg-zinc-950 border-zinc-800 text-zinc-100 text-xs h-8 focus:border-zinc-500"
                  />
                  <datalist id="existing-folders-datalist">
                    {existingFolders.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                </div>
              </div>

              {type === 'database' && (
                <div className="space-y-1">
                  <Label className="text-[11px] text-zinc-300 font-medium">Database Engine</Label>
                  <Select value={dbType} onValueChange={(val: any) => applyDbDefaults(val)}>
                    <SelectTrigger className="bg-zinc-950 border-zinc-800 text-zinc-100 text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
                      <SelectItem value="clickhouse" className="font-mono text-xs text-amber-400">
                        <div className="flex items-center gap-2">
                          <ClickHouseIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>ClickHouse</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="postgres" className="font-mono text-xs text-sky-400">
                        <div className="flex items-center gap-2">
                          <PostgresIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>PostgreSQL</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="mysql" className="font-mono text-xs text-cyan-400">
                        <div className="flex items-center gap-2">
                          <MySQLIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>MySQL / MariaDB</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="sqlite" className="font-mono text-xs text-emerald-400">
                        <div className="flex items-center gap-2">
                          <SQLiteIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>SQLite</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {!(type === 'database' && dbType === 'sqlite') ? (
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label htmlFor="conn-host" className="text-[11px] text-zinc-300 font-medium">
                      Host / IP Address *
                    </Label>
                    <Input
                      id="conn-host"
                      placeholder="10.37.159.112 or host.domain"
                      value={form.host}
                      onChange={(e) => set('host', e.target.value)}
                      required
                      className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="conn-port" className="text-[11px] text-zinc-300 font-medium">
                      Port *
                    </Label>
                    <Input
                      id="conn-port"
                      type="number"
                      value={form.port}
                      onChange={(e) => set('port', parseInt(e.target.value, 10) || 0)}
                      required
                      className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8 text-center"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="conn-db-path" className="text-[11px] text-zinc-300 font-medium">
                    SQLite Database File Path *
                  </Label>
                  <Input
                    id="conn-db-path"
                    placeholder="/path/to/database.db"
                    value={form.database}
                    onChange={(e) => set('database', e.target.value)}
                    required
                    className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <div className="space-y-1">
                  <Label htmlFor="conn-tags" className="text-[11px] text-zinc-300 font-medium">Tags</Label>
                  <Input
                    id="conn-tags"
                    placeholder="prod, clickhouse, vpn"
                    value={form.tags}
                    onChange={(e) => set('tags', e.target.value)}
                    className="bg-zinc-950 border-zinc-800 text-zinc-100 text-xs h-8"
                  />
                </div>

                {type === 'database' && dbType !== 'sqlite' && (
                  <div className="flex items-center justify-between border border-zinc-800 rounded-md px-2.5 py-1.5 mt-4 bg-zinc-900/30">
                    <div className="space-y-0.5">
                      <Label htmlFor="conn-ssl" className="text-xs text-zinc-200 cursor-pointer">SSL / TLS</Label>
                      <p className="text-[10px] text-zinc-500">Require secure connection</p>
                    </div>
                    <Switch
                      id="conn-ssl"
                      checked={form.ssl}
                      onCheckedChange={(checked) => set('ssl', checked)}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT COLUMN: Authentication & Credentials */}
            <div className="space-y-3 bg-zinc-900/20 p-3 rounded-lg border border-zinc-800/60">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 font-semibold border-b border-zinc-800/80 pb-1 flex items-center justify-between">
                <span>Security & Credentials</span>
                <ShieldCheck className="w-3.5 h-3.5 text-zinc-400" />
              </div>

              {type === 'database' ? (
                <>
                  {dbType !== 'sqlite' && (
                    <>
                      <div className="space-y-1">
                        <Label htmlFor="conn-db-user" className="text-[11px] text-zinc-300 font-medium">Username</Label>
                        <Input
                          id="conn-db-user"
                          placeholder={dbType === 'clickhouse' ? 'default' : dbType === 'postgres' ? 'postgres' : 'root'}
                          value={form.username}
                          onChange={(e) => set('username', e.target.value)}
                          className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8"
                        />
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="conn-db-pass" className="text-[11px] text-zinc-300 font-medium">Password</Label>
                        <div className="relative">
                          <Input
                            id="conn-db-pass"
                            type={showDbPassword ? 'text' : 'password'}
                            placeholder="••••••••"
                            value={form.dbPassword}
                            onChange={(e) => set('dbPassword', e.target.value)}
                            className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8 pr-8"
                          />
                          <button
                            type="button"
                            onClick={() => setShowDbPassword(!showDbPassword)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 transition-colors p-0.5"
                            tabIndex={-1}
                          >
                            {showDbPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <Label htmlFor="conn-database" className="text-[11px] text-zinc-300 font-medium">Database / Schema</Label>
                        <Input
                          id="conn-database"
                          placeholder={dbType === 'clickhouse' ? 'default or base' : 'e.g. production'}
                          value={form.database}
                          onChange={(e) => set('database', e.target.value)}
                          className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8"
                        />
                      </div>
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="conn-user" className="text-[11px] text-zinc-300 font-medium">Username *</Label>
                    <Input
                      id="conn-user"
                      placeholder="root or ubuntu"
                      value={form.username}
                      onChange={(e) => set('username', e.target.value)}
                      required
                      className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="conn-pass" className="text-[11px] text-zinc-300 font-medium">Password</Label>
                    <div className="relative">
                      <Input
                        id="conn-pass"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="•••••••• (optional if using Private Key)"
                        value={form.password}
                        onChange={(e) => set('password', e.target.value)}
                        className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8 pr-8"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 transition-colors p-0.5"
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="conn-key" className="text-[11px] text-zinc-300 font-medium">SSH Private Key</Label>
                    <textarea
                      id="conn-key"
                      rows={2}
                      value={form.privateKey}
                      onChange={(e) => set('privateKey', e.target.value)}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                      className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-500 no-scrollbar"
                    />
                  </div>

                  {form.privateKey && (
                    <div className="space-y-1">
                      <Label htmlFor="conn-passphrase" className="text-[11px] text-zinc-300 font-medium">Passphrase</Label>
                      <div className="relative">
                        <Input
                          id="conn-passphrase"
                          type={showPassphrase ? 'text' : 'password'}
                          placeholder="Key passphrase (if encrypted)"
                          value={form.passphrase}
                          onChange={(e) => set('passphrase', e.target.value)}
                          className="bg-zinc-950 border-zinc-800 text-zinc-100 font-mono text-xs h-8 pr-8"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassphrase(!showPassphrase)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 transition-colors p-0.5"
                          tabIndex={-1}
                        >
                          {showPassphrase ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ========================================================= */}
          {/* SSH TUNNEL / JUMP HOST (BASTION) COLLAPSIBLE CARD */}
          {/* ========================================================= */}
          <div className="rounded-lg border border-zinc-800/80 bg-zinc-900/30 overflow-hidden transition-all">
            <div className="p-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md bg-zinc-850 border border-zinc-700/60 flex items-center justify-center text-zinc-300">
                  <Network className="w-3.5 h-3.5 text-sky-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-zinc-200">
                      SSH Tunnel / Jump Host (Bastion)
                    </span>
                    <Badge variant="outline" className="text-[9px] border-sky-500/30 text-sky-400 bg-sky-950/40 py-0 h-4">
                      Optional
                    </Badge>
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Route connection through an intermediate bastion server to access internal networks.
                  </p>
                </div>
              </div>

              <Switch
                id="toggle-bastion"
                checked={form.useBastion}
                onCheckedChange={(checked) => set('useBastion', checked)}
              />
            </div>

            {/* Expanded Bastion Settings */}
            {form.useBastion && (
              <div className="p-3 pt-2 border-t border-zinc-800/60 bg-zinc-950/60 space-y-3 animate-in fade-in duration-150">
                {/* Mode Selector */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => set('bastionMode', 'reuse')}
                    className={`text-[11px] px-2.5 py-1 rounded font-medium transition-colors ${
                      form.bastionMode === 'reuse'
                        ? 'bg-zinc-800 text-white border border-zinc-700'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Reuse Saved SSH Server
                  </button>
                  <button
                    type="button"
                    onClick={() => set('bastionMode', 'custom')}
                    className={`text-[11px] px-2.5 py-1 rounded font-medium transition-colors ${
                      form.bastionMode === 'custom'
                        ? 'bg-zinc-800 text-white border border-zinc-700'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Custom Jump Host
                  </button>
                </div>

                {form.bastionMode === 'reuse' ? (
                  <div className="space-y-1">
                    <Label className="text-[11px] text-zinc-300 font-medium">Select Saved SSH Connection</Label>
                    {sshConnections.length === 0 ? (
                      <div className="p-2.5 border border-dashed border-zinc-800 rounded text-center text-xs text-zinc-500">
                        No saved SSH connections found. Please select &quot;Custom Jump Host&quot; above.
                      </div>
                    ) : (
                      <Select value={form.bastionReuseId} onValueChange={(val) => set('bastionReuseId', val)}>
                        <SelectTrigger className="bg-zinc-900 border-zinc-800 text-zinc-100 text-xs h-8">
                          <SelectValue placeholder="Choose an SSH connection..." />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                          {sshConnections.map((conn) => (
                            <SelectItem key={conn.id} value={conn.id} className="text-xs">
                              <div className="flex items-center gap-2">
                                <Server className="w-3 h-3 text-emerald-400" />
                                <span>{conn.name}</span>
                                <span className="text-zinc-500 font-mono text-[10px]">({conn.username}@{conn.host}:{conn.port})</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="bastion-host" className="text-[11px] text-zinc-300 font-medium">
                        Jump Host Address *
                      </Label>
                      <Input
                        id="bastion-host"
                        placeholder="bastion.internal or 10.x.x.x"
                        value={form.bastionHost}
                        onChange={(e) => set('bastionHost', e.target.value)}
                        className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-xs h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="bastion-port" className="text-[11px] text-zinc-300 font-medium">
                        Port
                      </Label>
                      <Input
                        id="bastion-port"
                        type="number"
                        value={form.bastionPort}
                        onChange={(e) => set('bastionPort', parseInt(e.target.value, 10) || 22)}
                        className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-xs h-8 text-center"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="bastion-user" className="text-[11px] text-zinc-300 font-medium">
                        Bastion Username *
                      </Label>
                      <Input
                        id="bastion-user"
                        placeholder="jumpuser"
                        value={form.bastionUsername}
                        onChange={(e) => set('bastionUsername', e.target.value)}
                        className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-xs h-8"
                      />
                    </div>

                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="bastion-pass" className="text-[11px] text-zinc-300 font-medium">
                        Bastion Password
                      </Label>
                      <div className="relative">
                        <Input
                          id="bastion-pass"
                          type={showBastionPassword ? 'text' : 'password'}
                          placeholder="••••••••"
                          value={form.bastionPassword}
                          onChange={(e) => set('bastionPassword', e.target.value)}
                          className="bg-zinc-900 border-zinc-800 text-zinc-100 font-mono text-xs h-8 pr-8"
                        />
                        <button
                          type="button"
                          onClick={() => setShowBastionPassword(!showBastionPassword)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 transition-colors p-0.5"
                          tabIndex={-1}
                        >
                          {showBastionPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Modal Footer with Live Test Connection status */}
          <DialogFooter className="pt-3 border-t border-zinc-800 flex flex-col sm:flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
                className="border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs h-8 px-3 gap-1.5 shadow-sm"
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                ) : (
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                )}
                <span>{testing ? 'Testing...' : 'Test Connection'}</span>
              </Button>

              {testResult && (
                <div className="flex items-center gap-1.5 animate-in fade-in duration-200">
                  {testResult.success ? (
                    <Badge className="bg-emerald-950/80 text-emerald-400 border-emerald-500/40 text-[11px] flex items-center gap-1 py-0.5 font-mono">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Connected {testResult.durationMs ? `(${testResult.durationMs}ms)` : ''}</span>
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="bg-rose-950/80 text-rose-300 border-rose-500/40 text-[11px] flex items-center gap-1 py-0.5 font-mono max-w-[280px] truncate"
                      title={testResult.message}
                    >
                      <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                      <span className="truncate">{testResult.message}</span>
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="border-zinc-800 text-zinc-400 hover:text-white h-8 text-xs px-3"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                className="bg-white hover:bg-zinc-200 text-zinc-950 font-medium h-8 text-xs px-4 shadow-sm"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                ) : editConnection ? (
                  'Update Connection'
                ) : (
                  'Save Connection'
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
