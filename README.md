项目需求。这是一个云端的剪切板项目，用户点击白板的空白地方会自动粘贴用户当前剪切板的第一个内容。无论是图片还是文字。都会用卡片的形式放在白板上，然后拖动粘贴的卡片也能移动。还要有多选功能，右上角有按钮可以切换多选模式，以及单选模式。单选模式就直接点击粘贴的卡片会复制卡片到剪切板上。多选模式就多选卡片，然后调起分享功能。

开发说明（Auth + Supabase 实时卡片）

- 依赖：`next-auth`（Credentials 邮箱+密码）、`@supabase/supabase-js`
- 环境变量：复制 `.env.example` 为 `.env.local` 并填写
  - `NEXTAUTH_SECRET`
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`

数据库表与存储（在 Supabase SQL 控制台执行）

```sql
-- 卡片表
create table if not exists public.cards (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('text','image')),
  text text,
  src text,
  x double precision not null,
  y double precision not null,
  width double precision not null,
  height double precision not null,
  scroll_y double precision default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 触发器自动更新时间
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_cards_updated_at on public.cards;
create trigger set_cards_updated_at before update on public.cards
for each row execute function public.set_updated_at();

-- 启用 RLS 与策略
alter table public.cards enable row level security;
drop policy if exists "own cards" on public.cards;
create policy "own cards" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 启用 Realtime 复制
alter publication supabase_realtime add table public.cards;
```

文件存储（图片）

- 创建存储桶 `cards`，设为 public 或使用签名 URL。
- 客户端在登录后将粘贴的图片上传到 `cards` 存储桶，路径：`<user_id>/<random>.ext`。

运行

```bash
npm run dev
```

登录/注册：访问 `/login`、`/register`。登录后白板中的卡片会自动同步到云端（含实时变更）。
