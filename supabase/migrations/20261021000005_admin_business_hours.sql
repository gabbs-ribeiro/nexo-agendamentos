-- Atualiza todos os intervalos de funcionamento do negocio de forma atomica.
create or replace function public.admin_replace_business_hours(
  p_business_id uuid,
  p_hours jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_interval jsonb;
  v_day text;
  v_opens text;
  v_closes text;
begin
  perform app_private.require_member(p_business_id);
  -- Serializa a troca de expediente com reservas e bloqueios do mesmo negócio.
  perform pg_advisory_xact_lock(hashtextextended(p_business_id::text, 0));

  if p_hours is null or jsonb_typeof(p_hours) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end if;

  for v_interval in select value from jsonb_array_elements(p_hours)
  loop
    if jsonb_typeof(v_interval) is distinct from 'object'
       or jsonb_typeof(v_interval->'day_of_week') is distinct from 'number'
       or jsonb_typeof(v_interval->'opens_minute') is distinct from 'number'
       or jsonb_typeof(v_interval->'closes_minute') is distinct from 'number' then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;

    v_day := v_interval->>'day_of_week';
    v_opens := v_interval->>'opens_minute';
    v_closes := v_interval->>'closes_minute';
    if v_day !~ '^[0-6]$'
       or v_opens !~ '^[0-9]{1,4}$'
       or v_closes !~ '^[0-9]{1,4}$'
       or v_opens::integer > 1439
       or v_closes::integer < 1
       or v_closes::integer > 1440
       or v_opens::integer >= v_closes::integer then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
    end if;
  end loop;

  begin
    delete from public.business_hours where business_id = p_business_id;
    insert into public.business_hours (business_id, day_of_week, opens_minute, closes_minute)
    select p_business_id,
           (value->>'day_of_week')::smallint,
           (value->>'opens_minute')::smallint,
           (value->>'closes_minute')::smallint
      from jsonb_array_elements(p_hours);
  exception
    when exclusion_violation or check_violation then
      return jsonb_build_object('ok', false, 'error', 'INVALID_INPUT');
  end;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.admin_replace_business_hours(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_replace_business_hours(uuid, jsonb)
  to authenticated;
