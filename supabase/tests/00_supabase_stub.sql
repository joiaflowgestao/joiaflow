do $$ begin create role anon nologin; exception when others then null; end $$; do $$ begin create role authenticated nologin; exception when others then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
grant usage on schema public to authenticated, anon;
-- Igual ao Supabase: novas tabelas em public já nascem com privilégios para authenticated
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
