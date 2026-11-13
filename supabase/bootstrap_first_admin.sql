-- =====================================================================
-- Execute UMA VEZ no SQL Editor do Supabase para criar o primeiro
-- administrador da plataforma (os demais usuários são criados pelo app).
--
-- 1) Authentication → Users → "Add user" → informe e-mail e senha,
--    marque "Auto Confirm User".
-- 2) Troque o e-mail e o nome abaixo e execute.
-- =====================================================================
insert into public.profiles (id, full_name, email, role, organization_id)
select u.id, 'SEU NOME COMPLETO', u.email, 'platform_admin', null
from auth.users u
where u.email = 'seu-email@exemplo.com'
on conflict (id) do update set role = 'platform_admin', active = true;
