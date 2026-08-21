# Charger le réseau de rues

Le fichier complet (`../data_tlemcen_roads.sql`, 748 Ko) dépasse la limite de
l'éditeur SQL Supabase. Deux façons de le charger.

## A. psql — une commande, recommandé

`psql` est déjà installé sur cette machine.

Récupérez la chaîne de connexion : **Supabase → Project Settings → Database →
Connection string → URI**, puis remplacez `[YOUR-PASSWORD]`.

```bash
cd /home/khalil/pothole-collect
psql "postgresql://postgres.VOTRE_REF:MOT_DE_PASSE@aws-0-REGION.pooler.supabase.com:5432/postgres" \
  -f supabase/data_tlemcen_roads.sql
```

C'est ici que la « session pooler info » sert : ces identifiants-là sont pour une
connexion Postgres directe, ce que l'API REST ne fait pas.

## B. L'éditeur SQL, en cinq morceaux

Si vous préférez ne pas exposer le mot de passe de la base, collez les fichiers
`part01.sql` … `part05.sql` **dans l'ordre**. Chacun fait environ 200 Ko.

Chaque partie est idempotente (`on conflict do nothing`) : relancer la même
partie deux fois est sans effet. `part01` crée les tables et vide les anciennes
données, donc recommencez toujours par elle si vous reprenez à zéro.

`part05` charge les quartiers et affiche un décompte — vous devez voir
**5149 voies** et **52 quartiers**.

## Ensuite

```
supabase/migration_009_road_names.sql
```

Il installe le résolveur, renomme tous les clusters existants et recalcule les
priorités.
