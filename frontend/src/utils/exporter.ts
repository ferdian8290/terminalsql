export function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export connections to TerminalSQL native JSON backup
 */
export function exportToTerminalSqlJson(connections: any[]) {
  const payload = {
    version: '1.0',
    app: 'TerminalSQL',
    exportedAt: new Date().toISOString(),
    totalCount: connections.length,
    connections: connections.map((c) => ({
      name: c.name,
      type: c.type,
      host: c.host,
      port: c.port,
      username: c.username,
      folder: c.folder || null,
      credentials: c.credentials || {},
      tags: c.tags || [],
      color: c.color || '#10b981',
    })),
  };

  const filename = `terminalsql-backup-${new Date().toISOString().slice(0, 10)}.json`;
  downloadBlob(JSON.stringify(payload, null, 2), filename, 'application/json');
}

/**
 * Export database connections to universal data-sources.json format
 */
export function exportToDataSourceJson(connections: any[]) {
  const dbConns = connections.filter((c) => c.type === 'database');
  const dsConnections: Record<string, any> = {};

  dbConns.forEach((conn, index) => {
    const creds = conn.credentials || {};
    const dbType = creds.dbType || (conn.port === 5432 ? 'postgres' : conn.port === 8123 ? 'clickhouse' : 'mysql');
    const driverId =
      dbType === 'postgres' ? 'postgres-jdbc' : dbType === 'clickhouse' ? 'clickhouse_jdbc' : dbType === 'sqlite' ? 'sqlite_jdbc' : 'mysql8';

    const connId = `${dbType}-${Date.now().toString(16)}-${index}`;

    dsConnections[connId] = {
      name: conn.name,
      provider: dbType === 'postgres' ? 'postgresql' : dbType,
      driver: driverId,
      'save-password': true,
      configuration: {
        host: conn.host,
        port: String(conn.port || (dbType === 'postgres' ? 5432 : dbType === 'clickhouse' ? 8123 : 3306)),
        database: creds.database || '',
        url:
          dbType === 'sqlite'
            ? `jdbc:sqlite:${conn.host}`
            : `jdbc:${dbType}://${conn.host}:${conn.port}/${creds.database || ''}`,
        user: conn.username || '',
        password: creds.dbPassword || '',
        type: 'dev',
        properties: {},
      },
    };
  });

  const payload = {
    folders: {},
    connections: dsConnections,
    'connection-types': {
      dev: {
        name: 'Development',
        color: '255,255,255',
        description: 'Regular development database',
        'auto-commit': true,
        'confirm-execute': false,
        'confirm-data-change': false,
      },
    },
  };

  const filename = `data-sources-${new Date().toISOString().slice(0, 10)}.json`;
  downloadBlob(JSON.stringify(payload, null, 2), filename, 'application/json');
}

// Backwards compatibility alias
export const exportToDBeaverJson = exportToDataSourceJson;

/**
 * Export SSH & SFTP connections to MobaXterm .mxtsessions file
 */
export function exportToMobaXtermSessions(connections: any[]) {
  const sshConns = connections.filter((c) => c.type === 'ssh' || c.type === 'sftp');
  const lines = [
    '[Bookmarks]',
    'SubRep=',
    'ImgNum=41',
    '[Bookmarks_1]',
    'SubRep=TerminalSQL Export',
    'ImgNum=41',
  ];

  sshConns.forEach((c) => {
    const isSftp = c.type === 'sftp';
    const typeNum = isSftp ? '2' : '0';
    // Format: SessionName=#109#typeNum%host%port%username%...
    const line = `${c.name}=#109#${typeNum}%${c.host}%${c.port}%${c.username}%%-1%-1%%%22%%0%0%0%%%-1%0%0%0%%1080%%0%0%1#MobaFont%10%0%0%-1%15%236,236,236%0%0%0%0%%-1%0%0%0%0#0# #-1`;
    lines.push(line);
  });

  const content = lines.join('\r\n');
  const filename = `mobaxterm-sessions-${new Date().toISOString().slice(0, 10)}.mxtsessions`;
  downloadBlob(content, filename, 'text/plain');
}

/**
 * Export connections to standard CSV (Excel / Termius / SecureCRT compatible)
 */
export function exportToCsv(connections: any[]) {
  const header = ['Name', 'Type', 'Host', 'Port', 'Username', 'Database', 'Tags'];
  const rows = connections.map((c) => {
    const creds = c.credentials || {};
    return [
      `"${(c.name || '').replace(/"/g, '""')}"`,
      `"${c.type}"`,
      `"${c.host}"`,
      c.port,
      `"${(c.username || '').replace(/"/g, '""')}"`,
      `"${(creds.database || '').replace(/"/g, '""')}"`,
      `"${(c.tags || []).join(', ')}"`,
    ].join(',');
  });

  const csv = [header.join(','), ...rows].join('\r\n');
  const filename = `terminalsql-connections-${new Date().toISOString().slice(0, 10)}.csv`;
  downloadBlob(csv, filename, 'text/csv');
}
