import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export class Store {
  constructor(directory, key) {
    this.key = Buffer.from(key || '', 'base64');
    if (this.key.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 random bytes encoded as base64.');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'connections.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS connections (subject TEXT PRIMARY KEY, secret TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, subject TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL);`);
  }
  subject(identity) { return createHash('sha256').update(`${identity.iss}\0${identity.sub}`).digest('hex'); }
  encrypt(subject, value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(subject));
    const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  decrypt(subject, value) {
    const raw = Buffer.from(value, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(subject)); decipher.setAuthTag(raw.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
  }
  put(subject, connection) {
    this.db.prepare('INSERT INTO connections VALUES (?,?) ON CONFLICT(subject) DO UPDATE SET secret=excluded.secret').run(subject, this.encrypt(subject, connection));
  }
  get(subject) {
    const row = this.db.prepare('SELECT secret FROM connections WHERE subject=?').get(subject);
    return row ? this.decrypt(subject, row.secret) : null;
  }
  remove(subject) { this.db.prepare('DELETE FROM connections WHERE subject=?').run(subject); this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
  audit(subject, action, outcome) {
    this.db.prepare('INSERT INTO audit (at,subject,action,outcome) VALUES (?,?,?,?)').run(new Date().toISOString(), subject, action, outcome);
  }
  close() { this.db.close(); }
}
