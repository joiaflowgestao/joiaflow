-- Nova categoria global: Pulseira
insert into public.categories (organization_id, name, slug, icon, sort_order)
values (null, 'Pulseira', 'pulseira', 'bracelet-chain', 7)
on conflict do nothing;
