项目需求。这是一个云端的剪切板项目，用户点击白板的空白地方会自动粘贴用户当前剪切板的第一个内容（图片或文字），以卡片形式放入白板并可拖动。项目基于 next-auth + Supabase，登录后在云端实时同步多端更新。

功能概览

- 粘贴入板：单击空白区域，自动粘贴剪贴板首项（图/文）为卡片；双击空白可手动添加文字卡片。
- 选择规则：单击任意卡片（文字/图片）切换选中，选中卡片边框高亮；单击空白清空选择。
- 文字卡片：双击卡片复制内容到剪贴板并提示“已复制”。
- 批量分享：仅分享“已选中的图片卡片”。右上角使用说明在折叠状态下，长条下方有“分享已选”按钮与计数；不支持设备会提示。
- 批量删除：删除“已选中的所有卡片”（包含文字与图片）。按钮在“分享已选”下方，并显示总计数。
- 画布交互：按住空格拖拽白板；Ctrl + 滚轮缩放；卡片可拖动、缩放（句柄）。
- 使用说明：页面加载约 5 秒后，右上角使用说明自动折叠为仅显示邮箱的长条；点击长条可展开。
- 实时同步：登录后，卡片保存在 Supabase，支持多端实时更新（插入、更新、删除）。

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

浏览器支持说明

- 分享依赖 Web Share API（以及可选的 `navigator.canShare({ files })`）来分享已选图片文件；如果当前设备或浏览器不支持，会弹出提示。
- 剪贴板读取图片内容依赖 `navigator.clipboard.read` 能力；不支持时会回退到读取文本（若可用）。
