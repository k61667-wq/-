-- ============================================================
--  혼잡스(HONJABS) 소개 사이트 - Supabase 초기 설정
--  Supabase 대시보드 → SQL Editor 에 붙여넣고 [Run] 하세요.
--  (한 번만 실행하면 됩니다. 공개 anon 키로 안전하게 동작하도록
--   INSERT/필요한 SELECT만 허용하는 RLS 정책을 함께 만듭니다.)
-- ============================================================

-- ────────────────────────────────
-- 1) 문의(inquiries) : 문의 폼 저장
-- ────────────────────────────────
create table if not exists public.inquiries (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  contact    text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

alter table public.inquiries enable row level security;

-- 방문자(anon)는 "쓰기(insert)"만 가능. 읽기는 막아서 개인정보 유출 방지.
drop policy if exists "anon insert inquiries" on public.inquiries;
create policy "anon insert inquiries"
  on public.inquiries for insert
  to anon
  with check (true);


-- ────────────────────────────────
-- 2) 구독자(subscribers) : 뉴스레터 이메일
-- ────────────────────────────────
create table if not exists public.subscribers (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,          -- 중복 구독 방지 (unique)
  created_at timestamptz not null default now()
);

alter table public.subscribers enable row level security;

drop policy if exists "anon insert subscribers" on public.subscribers;
create policy "anon insert subscribers"
  on public.subscribers for insert
  to anon
  with check (true);


-- ────────────────────────────────
-- 3) 방문자 카운터(page_stats) + 증가 함수
-- ────────────────────────────────
create table if not exists public.page_stats (
  id    text primary key,
  count bigint not null default 0
);

-- 홈 카운터 행 초기화 (이미 있으면 그대로 둠)
insert into public.page_stats (id, count)
values ('home', 0)
on conflict (id) do nothing;

alter table public.page_stats enable row level security;

-- 현재 카운트는 누구나 읽을 수 있게 (숫자만 노출)
drop policy if exists "anon read stats" on public.page_stats;
create policy "anon read stats"
  on public.page_stats for select
  to anon
  using (true);

-- 카운터 증가는 함수로만. anon 에게 직접 UPDATE 권한을 주지 않아
-- 임의 조작을 막고, security definer 로 안전하게 +1 처리.
create or replace function public.increment_visits()
returns bigint
language sql
security definer
set search_path = public
as $$
  update public.page_stats
     set count = count + 1
   where id = 'home'
  returning count;
$$;

grant execute on function public.increment_visits() to anon;

-- ============================================================
--  확인용 (선택):
--    select * from public.inquiries order by created_at desc;
--    select * from public.subscribers order by created_at desc;
--    select * from public.page_stats;
-- ============================================================
