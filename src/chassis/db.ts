import pg from 'pg';

/** O que um repositório precisa: só `query`. Funciona com o pool e com o client de uma transação. */
export type Tx = Pick<pg.PoolClient, 'query'>;

export type Migration = { id: string; sql: string };

export class Db {
  readonly pool: pg.Pool;

  constructor(url: string, ssl: boolean) {
    // Em RDS/Cloud SQL o certificado é da AWS/Google; para a demo aceitamos sem CA embutida.
    this.pool = new pg.Pool({ connectionString: url, max: 10, ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}) });
  }

  /** Consulta fora de transação (leituras). */
  get query(): Tx['query'] {
    return this.pool.query.bind(this.pool) as Tx['query'];
  }

  /** Executa `fn` numa transação. Agregado, outbox e inbox entram juntos ou nada entra. */
  async tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('select 1');
      return true;
    } catch {
      return false;
    }
  }

  /** Aplica migrações em ordem, uma vez cada, sob advisory lock (várias réplicas sobem juntas). */
  async migrate(migrations: Migration[]): Promise<void> {
    await this.tx(async (tx) => {
      await tx.query('select pg_advisory_xact_lock(727274)');
      await tx.query('create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())');
      const { rows } = await tx.query<{ id: string }>('select id from schema_migrations');
      const applied = new Set(rows.map((r) => r.id));
      for (const migration of migrations) {
        if (applied.has(migration.id)) continue;
        await tx.query(migration.sql);
        await tx.query('insert into schema_migrations (id) values ($1)', [migration.id]);
      }
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Tabelas de infraestrutura que todo serviço com banco tem. */
export const chassisMigrations: Migration[] = [
  {
    id: '000_outbox_inbox',
    sql: `
      create table outbox (
        id text primary key,
        topic text not null,
        event jsonb not null,
        created_at timestamptz not null default now(),
        published_at timestamptz
      );
      create index outbox_pending on outbox (created_at) where published_at is null;
      create table inbox (
        consumer text not null,
        event_id text not null,
        event_type text not null,
        processed_at timestamptz not null default now(),
        primary key (consumer, event_id)
      );
    `,
  },
];
