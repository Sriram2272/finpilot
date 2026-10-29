// A minimal stand-in for Cloudflare D1 backed by Node's built-in SQLite, so the real
// Worker routes and SQL can be tested without any network or Cloudflare account.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

class Statement {
    constructor(db, sql, args = []) {
        this.db = db;
        this.sql = sql;
        this.args = args;
    }
    bind(...args) {
        return new Statement(this.db, this.sql, args);
    }
    async first() {
        return this.db.prepare(this.sql).get(...this.args) ?? null;
    }
    async all() {
        return { results: this.db.prepare(this.sql).all(...this.args), success: true, meta: {} };
    }
    async run() {
        const r = this.db.prepare(this.sql).run(...this.args);
        return { results: [], success: true, meta: { changes: Number(r.changes) } };
    }
    exec() {
        return /^\s*(select|with)/i.test(this.sql) ? this.all() : this.run();
    }
}

export function createD1(migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url))) {
    const db = new DatabaseSync(':memory:');
    for (const f of readdirSync(migrationsDir).sort()) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
    return {
        prepare: (sql) => new Statement(db, sql),
        async batch(stmts) {
            db.exec('BEGIN');
            try {
                const out = [];
                for (const s of stmts) out.push(await s.exec());
                db.exec('COMMIT');
                return out;
            } catch (err) {
                db.exec('ROLLBACK');
                throw err;
            }
        },
    };
}
