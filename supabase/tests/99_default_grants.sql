-- Supabase concede estes privilégios por padrão; o RLS é quem filtra.
grant select, insert, update, delete on all tables in schema public to authenticated;
