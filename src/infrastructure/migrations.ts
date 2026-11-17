import type { Migration } from '../chassis/db.js';

export const migrations: Migration[] = [
  {
    id: '001_ordering',
    sql: `
      -- Projeção local do Catalog: o Ordering nunca chama o Catalog por HTTP.
      create table product_snapshots (
        sku text primary key,
        product_id text not null,
        product_name text not null,
        size text not null,
        color text not null,
        price_cents integer not null,
        available boolean not null default true,
        updated_at timestamptz not null default now()
      );
      create table carts (
        id text primary key,
        customer_id text not null,
        order_id text,
        created_at timestamptz not null default now()
      );
      create table cart_items (
        cart_id text not null references carts(id) on delete cascade,
        sku text not null,
        quantity integer not null check (quantity > 0),
        added_at timestamptz not null default now(),
        primary key (cart_id, sku)
      );
      create table orders (
        id text primary key,
        customer_id text not null,
        status text not null,
        currency text not null,
        total_cents integer not null,
        lines jsonb not null,
        payment jsonb,
        tracking_code text,
        cancel_reason text,
        history jsonb not null,
        version integer not null default 0,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
      create index orders_customer on orders (customer_id, created_at desc);
    `,
  },
];
