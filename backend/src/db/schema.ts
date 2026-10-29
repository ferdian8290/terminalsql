import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').unique().notNull(),
  passwordHash: text('password_hash').notNull(),
  totpSecret: text('totp_secret'),
  totpEnabled: integer('totp_enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastLogin: integer('last_login', { mode: 'timestamp' }),
});

export const connections = sqliteTable('connections', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  type: text('type', { enum: ['ssh', 'database', 'sftp'] }).notNull(),
  host: text('host').notNull(),
  port: integer('port').notNull(),
  username: text('username').notNull(),
  encryptedCredentials: text('encrypted_credentials').notNull(),
  tags: text('tags', { mode: 'json' }).notNull().$type<string[]>().default([]),
  color: text('color').notNull().default('#00d4ff'),
  folder: text('folder'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  lastUsed: integer('last_used', { mode: 'timestamp' }),
});

export const queryHistory = sqliteTable('query_history', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  connectionId: text('connection_id').references(() => connections.id),
  query: text('query').notNull(),
  durationMs: integer('duration_ms'),
  rowCount: integer('row_count'),
  status: text('status', { enum: ['success', 'error'] }).notNull().default('success'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  action: text('action').notNull(),
  resource: text('resource'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const sqlTemplates = sqliteTable('sql_templates', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  query: text('query').notNull(),
  dbType: text('db_type').notNull().default('all'),
  tags: text('tags', { mode: 'json' }).notNull().$type<string[]>().default([]),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});
