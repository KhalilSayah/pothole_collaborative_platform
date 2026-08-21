-- ============================================================================
--  "La carte admin est vide" — diagnostic. Lecture seule, lancez tout.
-- ============================================================================
set search_path = public, extensions;

-- 1. Y a-t-il seulement des données ?
select 'donnees' as etape,
       (select count(*) from clusters)                          as clusters_total,
       (select count(*) from clusters where confidence >= 0.15) as visibles_publiquement,
       (select count(*) from observations)                      as observations;

-- 2. La migration 008 est-elle passée ? C'est LA question.
select 'policy 008' as etape,
       exists (
         select 1 from pg_policy p
         join pg_class c on c.oid = p.polrelid
         where c.relname = 'clusters' and p.polname = 'clusters_read_authed'
       ) as policy_presente;

-- 3. Toutes les policies de lecture sur clusters, avec les rôles couverts.
--    Une colonne roles sans `authenticated` = la carte admin restera vide.
select 'policies' as etape, p.polname as policy,
       case p.polcmd when 'r' then 'SELECT' when 'w' then 'UPDATE'
                     when 'a' then 'INSERT' else p.polcmd::text end as cmd,
       array(select rolname from pg_roles where oid = any(p.polroles)) as roles
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relname = 'clusters'
order by cmd, p.polname;

-- 4. Votre compte est-il bien dans admins ?
select 'admins' as etape, a.email, a.display_name,
       u.email as auth_email, u.last_sign_in_at
from admins a
right join auth.users u on u.id = a.user_id;
-- Une ligne avec email/display_name à NULL = le compte auth existe mais
-- n'est PAS administrateur. C'est la ligne admins qui donne l'accès.

-- 5. Les GRANT de table (RLS dit quelles lignes, GRANT dit si on peut toucher).
select 'grants' as etape, table_name,
       string_agg(privilege_type, ', ' order by privilege_type) as accorde
from information_schema.role_table_grants
where grantee = 'authenticated' and table_schema = 'public'
  and table_name in ('clusters','observations','repairs','admins')
group by table_name order by table_name;
