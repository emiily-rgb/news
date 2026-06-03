-- Run logs
create table if not exists run_logs (
  id uuid primary key,
  run_at timestamptz not null default now(),
  run_by text not null default 'user',
  status text not null default 'running',
  total_collected int not null default 0,
  total_after_filter int not null default 0,
  insight_ko jsonb not null default '[]',
  insight_zh jsonb not null default '[]',
  insight_generated_at timestamptz,
  sent_at timestamptz,
  sent_by text,
  recipients jsonb not null default '[]',
  error text
);

-- Articles
create table if not exists articles (
  id uuid primary key,
  run_id uuid not null references run_logs(id) on delete cascade,
  category text not null,
  keyword text not null,
  title text not null,
  title_zh text,
  media text not null,
  media_tier int not null default 3,
  link text not null,
  pub_date timestamptz not null,
  summary_ko jsonb not null default '[]',
  summary_zh jsonb not null default '[]',
  sentiment text not null default 'neutral',
  relevance_score float not null default 0.5,
  order_index int not null default 0,
  excluded boolean not null default false,
  excluded_by text,
  excluded_at timestamptz,
  collected_at timestamptz not null default now()
);

create index if not exists articles_run_id_idx on articles(run_id);

-- Daily Alert Articles (수집 cron이 채움, 발송 cron이 읽음)
create table if not exists daily_alert_articles (
  id uuid primary key default gen_random_uuid(),
  slot int not null,               -- 12, 16, 21
  slot_date date not null,         -- KST 날짜
  title text not null,
  link text not null,
  pub_date timestamptz not null,
  media text not null,
  category text not null,
  keyword text not null,
  collected_at timestamptz not null default now()
);

create unique index if not exists daily_alert_articles_link_date_idx
  on daily_alert_articles(link, slot_date);

create index if not exists daily_alert_articles_slot_idx
  on daily_alert_articles(slot_date, slot);

-- Daily Alert Logs (발송 이력)
create table if not exists daily_alert_logs (
  id uuid primary key default gen_random_uuid(),
  slot int not null,
  slot_date date not null,
  sent_at timestamptz,
  recipients jsonb not null default '[]',
  article_count int not null default 0,
  status text not null default 'pending'  -- pending | sent | failed
);

-- Config
create table if not exists configs (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
