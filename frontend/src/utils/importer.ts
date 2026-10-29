export interface ParsedConnection {
  name: string;
  type: 'ssh' | 'database' | 'sftp';
  host: string;
  port: number;
  username: string;
  folder?: string | null;
  credentials?: {
    password?: string;
    privateKey?: string;
    passphrase?: string;
    dbPassword?: string;
    database?: string;
    dbType?: 'mysql' | 'postgres' | 'sqlite' | 'clickhouse';
    ssl?: boolean;
  };
  tags?: string[];
  color?: string;
  sourceTool: 'dbeaver' | 'mobaxterm' | 'filezilla' | 'securecrt' | 'termius' | 'terminalsql' | 'generic';
}

export interface ParseResult {
  detectedTool: string;
  connections: ParsedConnection[];
  errors: string[];
}

/**
 * Universal Connection Parser
 * Auto-detects format from DBeaver, MobaXterm, FileZilla, SecureCRT, Termius, or TerminalSQL.
 */
export function parseConnectionFile(content: string, filename = ''): ParseResult {
  const trimmed = content.trim();
  const lowerName = filename.toLowerCase();

  // 1. Check if JSON (DBeaver, Termius, or TerminalSQL)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json = JSON.parse(trimmed);

      // TerminalSQL native format
      if (json.version && Array.isArray(json.connections)) {
        return {
          detectedTool: 'TerminalSQL Backup',
          connections: json.connections.map((c: any) => ({
            name: c.name || 'Imported Connection',
            type: c.type || 'ssh',
            host: c.host || 'localhost',
            port: Number(c.port) || 22,
            username: c.username || '',
            folder: c.folder || null,
            credentials: c.credentials || {},
            tags: c.tags || ['imported'],
            color: c.color || '#10b981',
            sourceTool: 'terminalsql',
          })),
          errors: [],
        };
      }

      // DBeaver data-sources.json
      if (json.connections && typeof json.connections === 'object') {
        const conns: ParsedConnection[] = [];
        for (const [key, val] of Object.entries<any>(json.connections)) {
          const config = val.configuration || {};
          const provider = (val.provider || val.driver || '').toLowerCase();

          let dbType: 'mysql' | 'postgres' | 'sqlite' | 'clickhouse' = 'mysql';
          if (provider.includes('postgres') || provider.includes('pgsql')) dbType = 'postgres';
          else if (provider.includes('sqlite')) dbType = 'sqlite';
          else if (provider.includes('clickhouse')) dbType = 'clickhouse';
          else dbType = 'mysql';

          conns.push({
            name: val.name || key,
            type: 'database',
            host: config.host || (dbType === 'sqlite' ? config.database || 'local.db' : 'localhost'),
            port: Number(config.port) || (dbType === 'postgres' ? 5432 : dbType === 'clickhouse' ? 8123 : 3306),
            username: config.user || '',
            credentials: {
              dbPassword: config.password || '',
              database: config.database || '',
              dbType,
              ssl: false,
            },
            tags: ['dbeaver', dbType],
            color: '#a855f7',
            sourceTool: 'dbeaver',
          });
        }

        return {
          detectedTool: 'DBeaver (data-sources.json)',
          connections: conns,
          errors: [],
        };
      }

      // Termius JSON export (array of hosts)
      if (Array.isArray(json)) {
        const conns: ParsedConnection[] = [];
        for (const item of json) {
          const host = item.address || item.hostname || item.host;
          if (host) {
            conns.push({
              name: item.label || item.name || host,
              type: 'ssh',
              host,
              port: Number(item.port) || 22,
              username: item.username || item.user || '',
              credentials: {
                password: item.password || undefined,
              },
              tags: item.group_name ? ['termius', item.group_name] : ['termius'],
              color: '#10b981',
              sourceTool: 'termius',
            });
          }
        }
        if (conns.length > 0) {
          return {
            detectedTool: 'Termius (JSON Export)',
            connections: conns,
            errors: [],
          };
        }
      }
    } catch (e: any) {
      // JSON parse error, continue to text/xml/ini formats
    }
  }

  // 2. MobaXterm (.mxtsessions or .ini file)
  if (lowerName.endsWith('.mxtsessions') || trimmed.includes('[Bookmarks') || trimmed.includes('#109#')) {
    const conns: ParsedConnection[] = [];
    const lines = trimmed.split(/\r?\n/);

    for (const line of lines) {
      const match = line.match(/^([^=]+)=#109#([0-9]+)%([^%]+)%([0-9]+)%([^%]*)/);
      if (match) {
        const rawName = match[1].trim();
        const sessionTypeNum = match[2]; // 0: SSH, 2: SFTP
        const host = match[3];
        const port = Number(match[4]) || 22;
        const username = match[5] || '';

        conns.push({
          name: rawName,
          type: sessionTypeNum === '2' ? 'sftp' : 'ssh',
          host,
          port,
          username,
          tags: ['mobaxterm'],
          color: sessionTypeNum === '2' ? '#f59e0b' : '#10b981',
          sourceTool: 'mobaxterm',
        });
      }
    }

    if (conns.length > 0) {
      return {
        detectedTool: 'MobaXterm Sessions (.mxtsessions)',
        connections: conns,
        errors: [],
      };
    }
  }

  // 3. FileZilla (sitemanager.xml or FileZilla.xml)
  if (trimmed.includes('<FileZilla') || trimmed.includes('<Server>') || lowerName.includes('filezilla') || lowerName.includes('sitemanager')) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'text/xml');
      const servers = doc.querySelectorAll('Server');
      const conns: ParsedConnection[] = [];

      servers.forEach((srv) => {
        const host = srv.querySelector('Host')?.textContent?.trim() || '';
        const port = Number(srv.querySelector('Port')?.textContent?.trim()) || 22;
        const user = srv.querySelector('User')?.textContent?.trim() || '';
        const pass = srv.querySelector('Pass')?.textContent?.trim() || '';
        const name = srv.querySelector('Name')?.textContent?.trim() || host;
        const protocol = srv.querySelector('Protocol')?.textContent?.trim(); // 1 = SFTP

        if (host) {
          conns.push({
            name: name || `SFTP ${host}`,
            type: protocol === '1' || port === 22 ? 'sftp' : 'sftp',
            host,
            port,
            username: user,
            credentials: { password: pass || undefined },
            tags: ['filezilla'],
            color: '#f59e0b',
            sourceTool: 'filezilla',
          });
        }
      });

      if (conns.length > 0) {
        return {
          detectedTool: 'FileZilla Site Manager (XML)',
          connections: conns,
          errors: [],
        };
      }
    } catch { }
  }

  // 4. SecureCRT (XML format)
  if (trimmed.includes('<Session') && trimmed.includes('<Hostname')) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(trimmed, 'text/xml');
      const sessions = doc.querySelectorAll('Session');
      const conns: ParsedConnection[] = [];

      sessions.forEach((s) => {
        const host = s.querySelector('Hostname')?.textContent?.trim() || '';
        const user = s.querySelector('Username')?.textContent?.trim() || '';
        const port = Number(s.querySelector('Port')?.textContent?.trim()) || 22;
        const name = s.getAttribute('name') || s.querySelector('Name')?.textContent?.trim() || host;

        if (host) {
          conns.push({
            name,
            type: 'ssh',
            host,
            port,
            username: user,
            tags: ['securecrt'],
            color: '#10b981',
            sourceTool: 'securecrt',
          });
        }
      });

      if (conns.length > 0) {
        return {
          detectedTool: 'SecureCRT (XML)',
          connections: conns,
          errors: [],
        };
      }
    } catch { }
  }

  // 5. CSV format (Universal / SecureCRT / Termius CSV)
  if (trimmed.includes(',') && trimmed.includes('\n')) {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    if (lines.length > 1) {
      const header = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/^["']|["']$/g, ''));
      const hostIdx = header.findIndex((h) => h.includes('host') || h.includes('address') || h.includes('ip'));
      const nameIdx = header.findIndex((h) => h.includes('name') || h.includes('label') || h.includes('session'));
      const userIdx = header.findIndex((h) => h.includes('user'));
      const portIdx = header.findIndex((h) => h.includes('port'));
      const typeIdx = header.findIndex((h) => h.includes('type') || h.includes('protocol'));

      if (hostIdx !== -1) {
        const conns: ParsedConnection[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map((c) => c.trim().replace(/^["']|["']$/g, ''));
          const host = cols[hostIdx];
          if (!host) continue;

          const name = nameIdx !== -1 && cols[nameIdx] ? cols[nameIdx] : host;
          const user = userIdx !== -1 ? cols[userIdx] : '';
          const port = portIdx !== -1 ? Number(cols[portIdx]) || 22 : 22;
          const rawType = typeIdx !== -1 ? cols[typeIdx].toLowerCase() : 'ssh';

          let type: 'ssh' | 'database' | 'sftp' = 'ssh';
          if (rawType.includes('db') || rawType.includes('sql')) type = 'database';
          else if (rawType.includes('sftp') || rawType.includes('ftp')) type = 'sftp';

          conns.push({
            name,
            type,
            host,
            port,
            username: user,
            tags: ['csv-import'],
            color: type === 'ssh' ? '#10b981' : type === 'database' ? '#a855f7' : '#f59e0b',
            sourceTool: 'generic',
          });
        }

        if (conns.length > 0) {
          return {
            detectedTool: 'CSV Connection List',
            connections: conns,
            errors: [],
          };
        }
      }
    }
  }

  return {
    detectedTool: 'Unknown format',
    connections: [],
    errors: [
      'Unrecognized connection file format. Please upload DBeaver (data-sources.json), MobaXterm (.mxtsessions), FileZilla (.xml), SecureCRT (CSV/XML), Termius (JSON/CSV), or TerminalSQL backup.',
    ],
  };
}
