/**
 * Init container (ECS): cria o role e o database deste serviço na instância
 * compartilhada, com as credenciais de admin da plataforma. O container
 * principal só sobe depois que este termina com sucesso e usa credenciais
 * próprias, sem acesso aos databases dos outros serviços.
 *
 * No GCP isto é feito pelo Terraform (google_sql_database / google_sql_user).
 */
import pg from 'pg';

const required = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} é obrigatória`);
  return value;
};
const ident = (value: string): string => {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`identificador inválido: ${value}`);
  return value;
};
const literal = (value: string): string => `'${value.replace(/'/g, "''")}'`;

async function main() {
  const host = required('DB_HOST');
  const port = Number(process.env.DB_PORT ?? 5432);
  const ssl = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;
  const name = ident(required('DB_NAME'));
  const user = ident(required('DB_USER'));
  const password = required('DB_PASSWORD');

  const admin = new pg.Client({
    host,
    port,
    ssl,
    user: required('DB_ADMIN_USER'),
    password: required('DB_ADMIN_PASSWORD'),
    database: process.env.DB_ADMIN_DATABASE ?? 'postgres',
  });
  await admin.connect();
  try {
    const role = await admin.query('select 1 from pg_roles where rolname = $1', [user]);
    if (role.rowCount === 0) await admin.query(`create role ${user} login password ${literal(password)}`);
    else await admin.query(`alter role ${user} with login password ${literal(password)}`);

    const database = await admin.query('select 1 from pg_database where datname = $1', [name]);
    if (database.rowCount === 0) {
      // RDS: o admin precisa ser membro do role para criar o database com esse owner.
      await admin.query(`grant ${user} to current_user`);
      await admin.query(`create database ${name} owner ${user}`);
    }
    await admin.query(`revoke all on database ${name} from public`);
    console.log(JSON.stringify({ msg: 'database pronto', database: name, role: user }));
  } finally {
    await admin.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
