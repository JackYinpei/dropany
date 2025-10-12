# Dropany

Dropany 是一个云端白板式剪贴板，用户点击白板的空白区域即可把当前剪贴板内容（文字或图片）快速落盘为卡片，并在多端间实时同步。

## 使用方式

- 单击白板空白区域：自动粘贴剪贴板首项（图片或文字）并生成卡片。
- 双击白板空白区域：打开文本输入框，`Ctrl + Enter` 提交新的文字卡片，`Esc` 取消。
- 单击卡片：切换选中状态；拖动卡片主体或句柄移动、缩放，单击空白处清空选择。
- 双击文字卡片：立即复制卡片文本到剪贴板。
- 顶部提示中的按钮：**分享已选** 仅发送已选中的图片卡片，**删除已选** 会移除所有已选文字与图片卡片。
- 按住空格拖动画布，使用 `Ctrl + 滚轮` 缩放；右下角小地图可快速定位视图。
- 登录后卡片实时保存在 Supabase，自动在多端同步新增、更新与删除。

## 功能亮点

- 白板粘贴体验：粘贴图片或文字均会落入白板并保留原始比例。
- 文本与图片并存：支持批量选中、分享图片卡片以及批量删除。
- 操作反馈：复制、分享、删除等操作均有轻提示提示状态。
- 实时协作：登录态下依托 Supabase Realtime 持续同步卡片数据。

## 开发说明（Auth + Supabase 实时卡片）

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
