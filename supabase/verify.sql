-- ============================================================================
--  Smoke test. Run AFTER schema.sql, in the Supabase SQL editor.
--
--  Inserts a ride and two observations 5 m apart — one accelerometer hit, one
--  manual report — and checks that the fusion trigger merged them into a SINGLE
--  cluster. That is the whole system working end to end: insert, geography
--  index, trigger, clustering, confidence scoring.
--
--  It cleans up after itself, so it leaves no test data behind.
-- ============================================================================

do $$
declare
  v_ride uuid;
  v_obs1 uuid;
  v_obs2 uuid;
  v_clusters int;
  v_conf double precision;
  v_methods int;
begin
  insert into rides (started_at, platform, app_version, detector_config)
  values (now(), 'test', '0.0.0', '{"k_sigma":4.5}'::jsonb)
  returning id into v_ride;

  -- Accelerometer hit somewhere in Tlemcen.
  insert into observations
    (ride_id, method, observed_at, t_offset_ms, lat, lon,
     gps_accuracy_m, speed_mps, damage_type, severity, confidence, payload)
  values
    (v_ride, 'accel', now(), 1000, 34.88280, -1.31670,
     8, 13.5, 'pothole', 'medium', 0.6,
     '{"peak_g":-0.52,"z_score":18.2,"axle_confirmed":true}'::jsonb)
  returning id into v_obs1;

  -- Manual report ~5 m away, 2 s later: the same pothole, tapped by the driver.
  insert into observations
    (ride_id, method, observed_at, t_offset_ms, lat, lon,
     gps_accuracy_m, speed_mps, damage_type, severity, confidence, payload)
  values
    (v_ride, 'manual', now(), 3000, 34.88284, -1.31672,
     6, 13.5, 'pothole', 'high', 0.95, '{"reaction_lag_s":1.4}'::jsonb)
  returning id into v_obs2;

  select count(distinct oc.cluster_id) into v_clusters
  from observation_clusters oc where oc.observation_id in (v_obs1, v_obs2);

  select c.confidence, c.n_methods into v_conf, v_methods
  from clusters c
  join observation_clusters oc on oc.cluster_id = c.id
  where oc.observation_id = v_obs1;

  raise notice '--------------------------------------------';
  raise notice 'clusters formed : % (expected 1)', v_clusters;
  raise notice 'methods fused   : % (expected 2)', v_methods;
  raise notice 'confidence      : % (expected > 0.3)', round(v_conf::numeric, 3);
  raise notice 'severity        : % (expected high — worst wins)',
    (select severity from clusters c
     join observation_clusters oc on oc.cluster_id = c.id
     where oc.observation_id = v_obs1);
  raise notice '--------------------------------------------';

  if v_clusters <> 1 then
    raise exception 'FUSION FAILED: % clusters instead of 1', v_clusters;
  end if;
  if v_methods <> 2 then
    raise exception 'FUSION FAILED: % methods instead of 2', v_methods;
  end if;

  raise notice 'ALL CHECKS PASSED';

  -- Clean up: cascade removes the observations and their cluster links.
  delete from clusters c using observation_clusters oc
    where oc.cluster_id = c.id and oc.observation_id in (v_obs1, v_obs2);
  delete from rides where id = v_ride;
end $$;
