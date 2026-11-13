-- Categorias globais (dados de domínio, não fictícios)
insert into public.categories (organization_id, name, slug, icon, sort_order) values
  (null, 'Anel',        'anel',        'ring',       1),
  (null, 'Bracelete',   'bracelete',   'bracelet',   2),
  (null, 'Brinco',      'brinco',      'earring',    3),
  (null, 'Conjunto',    'conjunto',    'set',        4),
  (null, 'Cordão',      'cordao',      'necklace',   5),
  (null, 'Escapulário', 'escapulario', 'scapular',   6)
on conflict do nothing;
