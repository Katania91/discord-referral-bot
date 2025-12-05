const fs = require('fs');
const path = require('path');
let Database; // lazy require better-sqlite3 only if needed
const mysql = require('mysql2/promise');

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'referral.db');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function open() {
  const engine = (process.env.DB_ENGINE || 'sqlite').toLowerCase();
  if (engine === 'mysql') {
    const pool = mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'referral_bot',
      connectionLimit: 10,
      supportBigNumbers: true,
    });
    return { engine: 'mysql', mysql: pool };
  }

  ensureDir();
  if (!Database) {
    try { Database = require('better-sqlite3'); }
    catch (e) { throw new Error('better-sqlite3 is not installed. Set DB_ENGINE=mysql or install build tools to compile it.'); }
  }
  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  migrateSqlite(sqlite);
  return { engine: 'sqlite', sqlite };
}

function nowSec() { return Math.floor(Date.now() / 1000); }

function migrateSqlite(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      user_id TEXT PRIMARY KEY,
      tokens_left INTEGER NOT NULL,
      tokens_reset_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invites (
      code TEXT PRIMARY KEY,
      inviter_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_invites_inviter ON invites(inviter_id);

    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inviter_id TEXT NOT NULL,
      invite_code TEXT,
      invitee_id TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      expires_at INTEGER,
      confirm_started_at INTEGER,
      confirmed_at INTEGER,
      failure_reason TEXT,
      suspicious INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(inviter_id);
    CREATE INDEX IF NOT EXISTS idx_referrals_invitee ON referrals(invitee_id);

    CREATE TABLE IF NOT EXISTS rewards_awarded (
      user_id TEXT NOT NULL,
      tier INTEGER NOT NULL,
      awarded_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, tier)
    );
  `);
}

async function migrateMysql(conn) {
  await conn.mysql.execute('CREATE TABLE IF NOT EXISTS config (`key` VARCHAR(64) PRIMARY KEY, `value` TEXT NOT NULL)');
  await conn.mysql.execute(`CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(32) PRIMARY KEY,
    tokens_left INT NOT NULL,
    tokens_reset_at INT NOT NULL
  )`);
  await conn.mysql.execute(`CREATE TABLE IF NOT EXISTS invites (
    code VARCHAR(32) PRIMARY KEY,
    inviter_id VARCHAR(32) NOT NULL,
    channel_id VARCHAR(32) NOT NULL,
    created_at INT NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    INDEX idx_invites_inviter (inviter_id)
  )`);
  await conn.mysql.execute(`CREATE TABLE IF NOT EXISTS referrals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    inviter_id VARCHAR(32) NOT NULL,
    invite_code VARCHAR(32),
    invitee_id VARCHAR(32) NOT NULL,
    joined_at INT NOT NULL,
    status VARCHAR(16) NOT NULL,
    expires_at INT NULL,
    confirm_started_at INT NULL,
    confirmed_at INT NULL,
    failure_reason VARCHAR(32) NULL,
    suspicious TINYINT(1) NOT NULL DEFAULT 0,
    INDEX idx_referrals_inviter (inviter_id),
    INDEX idx_referrals_invitee (invitee_id)
  )`);
  await conn.mysql.execute(`CREATE TABLE IF NOT EXISTS rewards_awarded (
    user_id VARCHAR(32) NOT NULL,
    tier INT NOT NULL,
    awarded_at INT NOT NULL,
    PRIMARY KEY (user_id, tier)
  )`);
}

async function ensureDefaultConfig(conn) {
  if (conn.engine === 'mysql') {
    await migrateMysql(conn);
  }
  const defaults = {
    weekly_quota: '5',
    pending_ttl_days: '7',
    confirm_hold_days: '7',
    min_account_age_days: '30',
    required_role_id: '',
    entry_role_id: '',
    invited_role_id: '',
    invite_channel_id: '',
    log_channel_id: '',
    reward_channel_id: '',
    reward_tier1: process.env.REWARD_TIER1 || '5',
    reward_tier2: process.env.REWARD_TIER2 || '15',
    staff_role_id: '',
    link_creator_role_id: '',
    timezone: 'Europe/Rome',
    enforce_bot_invites: '0',
    leaderboard_channel_id: '',
    leaderboard_message_id: ''
  };
  for (const [k, v] of Object.entries(defaults)) {
    const row = await get(conn, 'SELECT value FROM config WHERE `key` = ?', [k]);
    if (!row) await upsertConfig(conn, k, v);
  }
}

async function upsertConfig(conn, key, value) {
  if (conn.engine === 'mysql') {
    await run(conn, 'INSERT INTO config(`key`,`value`) VALUES(?,?) ON DUPLICATE KEY UPDATE `value`=VALUES(`value`)', [key, String(value)]);
  } else {
    await run(conn, 'INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, String(value)]);
  }
}

// Low-level helpers
async function run(conn, sql, params = []) {
  if (conn.engine === 'mysql') {
    await conn.mysql.execute(sql, params);
    return;
  }
  conn.sqlite.prepare(sql).run(...params);
}
async function get(conn, sql, params = []) {
  if (conn.engine === 'mysql') {
    const [rows] = await conn.mysql.execute(sql, params);
    return rows[0];
  }
  return conn.sqlite.prepare(sql).get(...params);
}
async function all(conn, sql, params = []) {
  if (conn.engine === 'mysql') {
    const [rows] = await conn.mysql.execute(sql, params);
    return rows;
  }
  return conn.sqlite.prepare(sql).all(...params);
}

// Config helpers
async function getConfig(conn, key) {
  const row = await get(conn, 'SELECT value FROM config WHERE `key` = ?', [key]);
  return row ? row.value : null;
}
async function setConfig(conn, key, value) { await upsertConfig(conn, key, value); }
async function getAllConfig(conn) {
  const rows = await all(conn, 'SELECT `key`, `value` FROM config');
  return rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
}

// Users
async function getOrCreateUser(conn, userId) {
  let user = await get(conn, 'SELECT * FROM users WHERE user_id = ?', [userId]);
  if (!user) {
    const quota = parseInt((await getConfig(conn, 'weekly_quota')) || '5', 10);
    await run(conn, 'INSERT INTO users(user_id,tokens_left,tokens_reset_at) VALUES(?,?,?)', [userId, quota, nowSec()]);
    user = await get(conn, 'SELECT * FROM users WHERE user_id = ?', [userId]);
  }
  return user;
}
async function addTokens(conn, userId, delta) {
  await getOrCreateUser(conn, userId);
  // portable clamp to >=0
  await run(conn, 'UPDATE users SET tokens_left = CASE WHEN tokens_left + ? < 0 THEN 0 ELSE tokens_left + ? END WHERE user_id = ?', [delta, delta, userId]);
}
async function setTokens(conn, userId, amount) {
  await getOrCreateUser(conn, userId);
  await run(conn, 'UPDATE users SET tokens_left = ? WHERE user_id = ?', [amount, userId]);
}
async function getTokens(conn, userId) {
  const u = await getOrCreateUser(conn, userId);
  return u.tokens_left;
}
async function resetAllTokens(conn) {
  const quota = parseInt((await getConfig(conn, 'weekly_quota')) || '5', 10);
  await run(conn, 'UPDATE users SET tokens_left = ?, tokens_reset_at = ?', [quota, nowSec()]);
}

// Invites
async function createInviteRecord(conn, code, inviterId, channelId, createdAt) {
  if (conn.engine === 'mysql') {
    await run(conn, 'INSERT INTO invites(code,inviter_id,channel_id,created_at,active) VALUES(?,?,?,?,1) ON DUPLICATE KEY UPDATE inviter_id=VALUES(inviter_id), channel_id=VALUES(channel_id), created_at=VALUES(created_at), active=1', [code, inviterId, channelId, createdAt]);
  } else {
    await run(conn, 'INSERT OR REPLACE INTO invites(code,inviter_id,channel_id,created_at,active) VALUES(?,?,?,?,1)', [code, inviterId, channelId, createdAt]);
  }
}
async function setInviteActive(conn, code, active) {
  await run(conn, 'UPDATE invites SET active = ? WHERE code = ?', [active ? 1 : 0, code]);
}
async function getInviteByCode(conn, code) {
  return await get(conn, 'SELECT * FROM invites WHERE code = ?', [code]);
}
async function getActiveInviteByInviter(conn, inviterId) {
  return await get(conn, 'SELECT * FROM invites WHERE inviter_id = ? AND active = 1 LIMIT 1', [inviterId]);
}

// Referrals
async function createReferralPending(conn, { inviterId, inviteCode, inviteeId, joinedAt, expiresAt, suspicious }) {
  const exists = await get(conn, "SELECT id, status FROM referrals WHERE invitee_id = ? AND status IN ('pending','holding') ORDER BY id DESC LIMIT 1", [inviteeId]);
  if (exists) return exists.id;
  if (conn.engine === 'mysql') {
    const [res] = await conn.mysql.execute('INSERT INTO referrals(inviter_id, invite_code, invitee_id, joined_at, status, expires_at, suspicious) VALUES(?,?,?,?,\'pending\',?,?)', [inviterId, inviteCode, inviteeId, joinedAt, expiresAt ?? null, suspicious ? 1 : 0]);
    return res.insertId;
  } else {
    const info = conn.sqlite.prepare('INSERT INTO referrals(inviter_id, invite_code, invitee_id, joined_at, status, expires_at, suspicious) VALUES(?,?,?,?,\'pending\',?,?)').run(inviterId, inviteCode, inviteeId, joinedAt, expiresAt ?? null, suspicious ? 1 : 0);
    return info.lastInsertRowid;
  }
}
async function getPendingByInvitee(conn, inviteeId) {
  return await get(conn, "SELECT * FROM referrals WHERE invitee_id = ? AND status IN ('pending','holding') ORDER BY id DESC LIMIT 1", [inviteeId]);
}
async function startHold(conn, inviteeId) {
  await run(conn, "UPDATE referrals SET status = 'holding', confirm_started_at = ? WHERE invitee_id = ? AND status = 'pending'", [nowSec(), inviteeId]);
}
async function confirmReferral(conn, inviteeId) {
  await run(conn, "UPDATE referrals SET status = 'confirmed', confirmed_at = ? WHERE invitee_id = ? AND status = 'holding'", [nowSec(), inviteeId]);
}
async function failReferral(conn, inviteeId, reason) {
  await run(conn, "UPDATE referrals SET status = 'failed', failure_reason = ? WHERE invitee_id = ? AND status IN ('pending','holding')", [reason || 'failed', inviteeId]);
}
async function consumeToken(conn, inviterId) { await addTokens(conn, inviterId, -1); }

async function getUserStats(conn, userId) {
  const rowP = await get(conn, "SELECT COUNT(*) AS c FROM referrals WHERE inviter_id = ? AND status IN ('pending','holding')", [userId]);
  const rowC = await get(conn, "SELECT COUNT(*) AS c FROM referrals WHERE inviter_id = ? AND status = 'confirmed'", [userId]);
  const rowF = await get(conn, "SELECT COUNT(*) AS c FROM referrals WHERE inviter_id = ? AND status = 'failed'", [userId]);
  const tokens = await getTokens(conn, userId);
  return { pending: rowP?.c || 0, confirmed: rowC?.c || 0, failed: rowF?.c || 0, tokens };
}

async function getLeaderboard(conn, period) {
  let threshold = 0;
  const now = nowSec();
  if (period === 'week') threshold = now - 7 * 86400;
  else if (period === 'month') threshold = now - 30 * 86400;
  const where = threshold ? 'AND confirmed_at >= ?' : '';
  const params = threshold ? [threshold] : [];
  const rows = await all(conn, `
    SELECT inviter_id, COUNT(*) AS confirmed
    FROM referrals
    WHERE status = 'confirmed' ${where}
    GROUP BY inviter_id
    ORDER BY confirmed DESC, inviter_id ASC
    LIMIT 20
  `, params);
  return rows;
}

async function getConfirmedCount(conn, userId) {
  const row = await get(conn, "SELECT COUNT(*) AS c FROM referrals WHERE inviter_id = ? AND status = 'confirmed'", [userId]);
  return row?.c || 0;
}
async function hasReward(conn, userId, tier) {
  const row = await get(conn, 'SELECT 1 FROM rewards_awarded WHERE user_id = ? AND tier = ?', [userId, tier]);
  return !!row;
}
async function markReward(conn, userId, tier) {
  if (conn.engine === 'mysql') {
    await run(conn, 'INSERT IGNORE INTO rewards_awarded(user_id, tier, awarded_at) VALUES(?,?,?)', [userId, tier, nowSec()]);
  } else {
    await run(conn, 'INSERT OR IGNORE INTO rewards_awarded(user_id, tier, awarded_at) VALUES(?,?,?)', [userId, tier, nowSec()]);
  }
}

async function getPendingHolding(conn) {
  return await all(conn, "SELECT * FROM referrals WHERE status IN ('pending','holding')");
}

async function getLatestReferralByInvitee(conn, inviteeId) {
  return await get(conn, 'SELECT * FROM referrals WHERE invitee_id = ? ORDER BY id DESC LIMIT 1', [inviteeId]);
}

async function getReferralsByInviter(conn, inviterId, status = 'all', limit = 20) {
  const lim = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));
  const params = [inviterId];
  let where = '';
  if (status && status !== 'all') {
    where = 'AND status = ?';
    params.push(status);
  }
  const sql = `
    SELECT invitee_id, status, joined_at, confirm_started_at, confirmed_at, failure_reason
    FROM referrals
    WHERE inviter_id = ? ${where}
    ORDER BY id DESC
    LIMIT ${lim}
  `;
  return await all(conn, sql, params);
}

module.exports = {
  open,
  ensureDefaultConfig,
  getConfig,
  setConfig,
  getAllConfig,
  getOrCreateUser,
  addTokens,
  setTokens,
  getTokens,
  resetAllTokens,
  createInviteRecord,
  setInviteActive,
  getInviteByCode,
  getActiveInviteByInviter,
  createReferralPending,
  getPendingByInvitee,
  startHold,
  confirmReferral,
  failReferral,
  consumeToken,
  getUserStats,
  getLeaderboard,
  getConfirmedCount,
  hasReward,
  markReward,
  getPendingHolding,
  getLatestReferralByInvitee,
  getReferralsByInviter,
};
