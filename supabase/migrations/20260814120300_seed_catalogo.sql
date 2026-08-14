-- =============================================================================
-- 0004 — Seed do catálogo
-- =============================================================================
-- GERADO AUTOMATICAMENTE por scripts/generate-seed-sql.ts — não edite à mão.
-- Para alterar, mude src/lib/quote/catalog.ts e rode: npm run seed:sql
--
-- Idempotente: apaga a versão "Catálogo inicial" e a recria do zero.
-- =============================================================================

do $$
declare
  v_id uuid;
  m_id uuid;
begin
  -- Remove um seed anterior, se existir. Orçamentos já salvos NÃO são afetados:
  -- eles carregam o próprio snapshot congelado do catálogo.
  delete from public.catalog_versions where label = 'Catálogo inicial';

  insert into public.catalog_versions (label, status, notes)
  values ('Catálogo inicial', 'rascunho',
          'Semeado a partir de src/lib/quote/catalog.ts. Valores de exemplo — calibrar antes de uso comercial.')
  returning id into v_id;


  -- Processos de corte
  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, 'laser-fibra', 'Laser de fibra', 240, 0.15,
    8, 3, 3000, 1500, 'Metais em geral. Melhor relação custo-precisão para chapa fina.'
  );
  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, 'laser-co2', 'Laser CO₂', 160, 0.25,
    6, 3, 1300, 900, 'Acrílico, madeira e polímeros. Borda polida em acrílico.'
  );
  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, 'jato-dagua', 'Jato d’água abrasivo', 380, 0.9,
    20, 6, 2000, 1500, 'Sem zona termicamente afetada. Compósitos, titânio e chapa grossa.'
  );
  insert into public.processes (
    version_id, code, name, machine_rate_per_hour, kerf,
    handling_seconds_per_part, base_lead_days, sheet_width, sheet_height, description
  ) values (
    v_id, 'router-cnc', 'Router CNC', 130, 3.175,
    12, 4, 2440, 1220, 'Madeira, MDF e plásticos espessos. Fresa de 1/8".'
  );

  -- Acabamentos
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'nenhum', 'Sem acabamento', 0, 0,
    0, 0, 'Peça sai como cortada, com rebarba e óxido de corte.', 0
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'rebarbado', 'Rebarbação', 0, 35,
    2.4, 1, 'Remove a aresta viva e o respingo de corte.', 1
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'escovado', 'Escovado (grão 240)', 95, 60,
    3.2, 2, 'Acabamento direcional em inox e latão.', 2
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'polido', 'Polido espelhado', 210, 90,
    6, 3, 'Polimento mecânico progressivo.', 3
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'jateado', 'Jateamento', 78, 70,
    2.8, 2, 'Textura fosca uniforme; boa base para pintura.', 4
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'zincado', 'Zincagem eletrolítica', 120, 140,
    3.5, 4, 'Proteção contra corrosão em aço carbono.', 5
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'pintura-po', 'Pintura a pó', 165, 180,
    5.5, 5, 'Camada epóxi-poliéster curada em estufa.', 6
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'anodizado', 'Anodização', 195, 210,
    5, 6, 'Camada de óxido dura, só para alumínio.', 7
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'eletropolido', 'Eletropolimento', 260, 240,
    7, 6, 'Passivação e brilho para inox de grau sanitário/médico.', 8
  );
  insert into public.finishes (
    version_id, code, name, price_per_m2, setup_cost, price_per_part, lead_days, description, sort_order
  ) values (
    v_id, 'lixado', 'Lixado', 45, 25,
    1.8, 1, 'Remove a fibra levantada no corte de madeira.', 9
  );

  -- Faixas de quantidade
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 1, 1);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 5, 0.94);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 10, 0.89);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 25, 0.84);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 50, 0.79);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 100, 0.74);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 250, 0.7);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 500, 0.66);
  insert into public.quantity_breaks (version_id, min_qty, variable_factor) values (v_id, 1000, 0.62);

  -- Parâmetros de pedido e serviços
  insert into public.catalog_settings (
    version_id, currency, locale, minimum_order_value, margin_rate,
    order_handling_fee, max_instant_lead_days, cut_setup_cost, services
  ) values (
    v_id, 'BRL', 'pt-BR', 180, 0.42,
    28, 20, 65,
    '{"bending":{"setupPerBendLine":85,"secondsPerBend":14,"ratePerHour":190,"leadDays":2,"maxBendLength":2500},"tapping":{"setupCost":45,"secondsPerHole":22,"ratePerHour":120,"leadDays":1},"hardware":{"setupCost":60,"secondsPerInsert":18,"ratePerHour":130,"pricePerInsert":3.8,"leadDays":1},"etching":{"setupCost":25,"speedMPerMin":20,"leadDays":0}}'::jsonb
  );

  -- Materiais, espessuras e acabamentos compatíveis

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'aco-1020', 'Aço carbono SAE 1020', 'Aço carbono', 'laser-fibra', 7.85,
    9.5, 0.18, true, 'Oxida sem acabamento. Especifique zincagem ou pintura para uso externo.', 0
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.9, '0,90 mm (20 ga)', 14, 0.3, 1,
    1, true, 4, 0.9, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.2, '1,20 mm (18 ga)', 12, 0.35, 1,
    1, true, 4, 1.2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.5, '1,50 mm (16 ga)', 10, 0.4, 1,
    1, true, 4, 1.5, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm (14 ga)', 7.5, 0.5, 1,
    1, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm (11 ga)', 4.5, 0.8, 1,
    1, true, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 4.75, '4,75 mm (3/16")', 2.4, 1.4, 1,
    1, true, 4, 4.75, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6.35, '6,35 mm (1/4")', 1.5, 2.2, 1,
    1, false, 4, 6.35, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 9.525, '9,53 mm (3/8")', 0.9, 4, 1,
    1, false, 4, 9.525, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 12.7, '12,70 mm (1/2")', 0.6, 6.5, 1,
    1, false, 4, 12.7, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'zincado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'pintura-po', 3);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 4);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'inox-304', 'Aço inox 304', 'Aço inox', 'laser-fibra', 8,
    42, 0.2, true, 'Padrão para contato com alimentos e ambientes corrosivos.', 1
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 11, 0.4, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.2, '1,20 mm', 9, 0.5, 1,
    1, true, 4, 1.2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.5, '1,50 mm', 7.5, 0.6, 1,
    1, true, 4, 1.5, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 5.5, 0.8, 1,
    1, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 3.2, 1.3, 1,
    1, true, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 4, '4,00 mm', 2, 2, 1,
    1, true, 4, 4, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6, '6,00 mm', 1.1, 3.4, 1,
    1, true, 4, 6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 8, '8,00 mm', 0.7, 5.5, 1,
    1, false, 4, 8, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'escovado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 3);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'eletropolido', 4);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'inox-316l', 'Aço inox 316L', 'Aço inox', 'laser-fibra', 8,
    68, 0.2, true, 'Grau cirúrgico/implantável. Exigido em ambientes com cloretos.', 2
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 10, 0.45, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.2, '1,20 mm', 8.5, 0.55, 1,
    1, true, 4, 1.2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.5, '1,50 mm', 7, 0.65, 1,
    1, true, 4, 1.5, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 5, 0.9, 1,
    1, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 3, 1.4, 1,
    1, true, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 4, '4,00 mm', 1.8, 2.2, 1,
    1, true, 4, 4, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'escovado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'eletropolido', 3);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 4);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'aluminio-5052', 'Alumínio 5052-H32', 'Alumínio', 'laser-fibra', 2.68,
    48, 0.18, true, 'Melhor liga para dobra. Padrão para gabinetes e chassis.', 3
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 16, 0.3, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1, '1,00 mm', 15, 0.3, 1,
    1, true, 4, 1, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.6, '1,60 mm (1/16")', 12, 0.4, 1,
    1, true, 4, 1.6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 10, 0.5, 1,
    1, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3.175, '3,18 mm (1/8")', 6, 0.9, 1,
    1, true, 4, 3.175, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 4.76, '4,76 mm (3/16")', 3.5, 1.5, 1,
    1, true, 4, 4.76, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6.35, '6,35 mm (1/4")', 2.2, 2.4, 1,
    1, false, 4, 6.35, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'anodizado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'pintura-po', 3);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 4);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'aluminio-6061', 'Alumínio 6061-T6', 'Alumínio', 'laser-fibra', 2.7,
    55, 0.18, true, 'Mais resistente que o 5052, porém trinca em dobras fechadas.', 4
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.6, '1,60 mm (1/16")', 12, 0.4, 1,
    1, true, 5, 1.6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3.175, '3,18 mm (1/8")', 6, 0.9, 1,
    1, true, 5, 3.175, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6.35, '6,35 mm (1/4")', 2.2, 2.4, 1,
    1, false, 5, 6.35, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 9.525, '9,53 mm (3/8")', 1.2, 4.2, 1,
    1, false, 5, 9.525, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 12.7, '12,70 mm (1/2")', 0.7, 7, 1,
    1, false, 5, 12.7, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'anodizado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 3);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'latao-260', 'Latão C260', 'Latão e cobre', 'laser-fibra', 8.53,
    78, 0.22, true, null, 5
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 8, 0.5, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.6, '1,60 mm', 5.5, 0.8, 1,
    1, true, 4, 1.6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3.175, '3,18 mm', 2.8, 1.6, 1,
    1, true, 4, 3.175, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'escovado', 2);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'polido', 3);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'cobre-110', 'Cobre C110', 'Latão e cobre', 'laser-fibra', 8.94,
    96, 0.22, false, 'Alta refletividade: corte mais lento e sujeito a análise prévia.', 6
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 0.8, '0,80 mm', 6, 0.7, 1,
    1, true, 4, 0.8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1.6, '1,60 mm', 4, 1.1, 1,
    1, true, 4, 1.6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3.175, '3,18 mm', 2, 2.2, 1,
    1, true, 4, 3.175, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'polido', 2);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'titanio-gr2', 'Titânio Grau 2', 'Titânio', 'jato-dagua', 4.51,
    420, 0.28, true, 'Cortado em jato d’água para evitar zona termicamente afetada.', 7
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 1, '1,00 mm', 1.4, 6, 1.5,
    1.5, true, 4, 1, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 0.8, 9, 1.5,
    1.5, true, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 0.5, 12, 1.5,
    1.5, true, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6, '6,00 mm', 0.25, 20, 1.5,
    1.5, false, 4, 6, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'jateado', 2);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'acrilico', 'Acrílico (PMMA)', 'Plásticos', 'laser-co2', 1.19,
    62, 0.2, false, 'Borda sai polida no laser CO₂. Não dobra a frio.', 8
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 6, 0.4, 1.2,
    1.5, false, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 4.5, 0.5, 1.2,
    1.5, false, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 5, '5,00 mm', 2.5, 0.8, 1.2,
    1.5, false, 4, 5, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 8, '8,00 mm', 1.2, 1.4, 1.2,
    1.5, false, 4, 8, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 10, '10,00 mm', 0.8, 2, 1.2,
    1.5, false, 4, 10, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'policarbonato', 'Policarbonato', 'Plásticos', 'router-cnc', 1.2,
    74, 0.2, false, 'Queima no laser: usinado em router para manter transparência.', 9
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 2, '2,00 mm', 3.5, 1.5, 1.5,
    2, false, 4, 2, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 3, 1.8, 1.5,
    2, false, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6, '6,00 mm', 1.8, 2.5, 1.5,
    2, false, 4, 6, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'rebarbado', 1);

  insert into public.materials (
    version_id, code, name, family, process_code, density,
    price_per_kg, scrap_factor, tappable, notes, sort_order
  ) values (
    v_id, 'mdf', 'MDF', 'Madeira', 'router-cnc', 0.75,
    12, 0.22, false, null, 10
  ) returning id into m_id;
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 3, '3,00 mm', 5, 1.2, 1.2,
    2, false, 4, 3, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 6, '6,00 mm', 4, 1.5, 1.2,
    2, false, 4, 6, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 9, '9,00 mm', 3, 2, 1.2,
    2, false, 4, 9, true
  );
  insert into public.material_thicknesses (
    material_id, mm, label, cut_speed_m_per_min, pierce_seconds, min_hole_ratio,
    min_web_ratio, bendable, min_flange_ratio, bend_radius, available
  ) values (
    m_id, 15, '15,00 mm', 1.8, 3, 1.2,
    2, false, 4, 15, true
  );
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'nenhum', 0);
  insert into public.material_finishes (material_id, finish_code, sort_order) values (m_id, 'lixado', 1);

  -- Publica a versão recém-criada.
  update public.catalog_versions set status = 'arquivado' where status = 'publicado';
  update public.catalog_versions set status = 'publicado', published_at = now() where id = v_id;

  raise notice 'Catálogo semeado e publicado: %', v_id;
end;
$$;

-- =============================================================================
-- Promover seu usuário a administrador
-- =============================================================================
-- Rode DEPOIS de criar a conta pela tela de cadastro do app.
-- Troque o e-mail e execute:
--
--   update public.profiles
--      set role = 'admin'
--    where id = (select id from auth.users where email = 'voce@empresa.com.br');
--
-- Sem isso ninguém consegue editar o catálogo pela interface — o que é o
-- comportamento correto: admin não é o padrão.
-- =============================================================================
