-- Align timed-stay snapshots with the 12-hour billing options while preserving
-- records created under the previous billing rule.
alter table public.stay_bookings
  drop constraint if exists stay_bookings_timed_snapshot;

alter table public.stay_bookings
  add constraint stay_bookings_timed_snapshot check (
    (check_in_at is null and check_out_at is null
      and duration_minutes is null and charge_units is null)
    or (check_in_at is not null and check_out_at is not null
      and duration_minutes between 1 and 43200
      and duration_minutes = extract(epoch from (check_out_at - check_in_at)) / 60
      and (
        (
          charge_units between 1 and 30
          and charge_units = case
            when duration_minutes <= 1440 then 1
            else 1 + ((duration_minutes - 1440) / 720.0) * 0.5
          end
        )
        or (
          duration_minutes >= 720
          and duration_minutes % 720 = 0
          and charge_units = duration_minutes / 1440.0
        )
      )
      and total_price_cents = round(daily_price_cents * charge_units)::integer)
  );
