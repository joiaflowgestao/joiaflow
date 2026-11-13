-- Nova categoria global: Tornozeleira
insert into public.categories (organization_id, name, slug, icon, sort_order)
values (null, 'Tornozeleira', 'tornozeleira', 'anklet', 8)
on conflict do nothing;
