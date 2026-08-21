-- Derniere partie : quartiers + statistiques.

set search_path = public, extensions;

insert into osm_places (osm_id, name, place, geom) values
  (472274882,'Aïn El Hadjar','village',st_geogfromtext('SRID=4326;POINT(-1.36675 34.92868)')),
  (519391702,'Safsaf','village',st_geogfromtext('SRID=4326;POINT(-1.27596 34.89995)')),
  (841797699,'Mansourah','town',st_geogfromtext('SRID=4326;POINT(-1.33026 34.87332)')),
  (858997857,'Ouzidane','village',st_geogfromtext('SRID=4326;POINT(-1.28531 34.93558)')),
  (1029490529,'Imama','suburb',st_geogfromtext('SRID=4326;POINT(-1.34216 34.88439)')),
  (1029490540,'Cité Malika','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.33347 34.88964)')),
  (1056501807,'Ain Nedjar','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.33020 34.87961)')),
  (1056501813,'Bel Horizon','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.32656 34.87948)')),
  (1056668731,'Les Dahlias','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.32945 34.89459)')),
  (1056967063,'Birouana','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.30138 34.87416)')),
  (1056967064,'Sidi Tahar','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.29156 34.87541)')),
  (1056971105,'Sidi Abed','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.29034 34.87795)')),
  (1057060526,'El Kalaa','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.31044 34.87392)')),
  (1057060533,'Boudghene','suburb',st_geogfromtext('SRID=4326;POINT(-1.31784 34.87147)')),
  (1057092210,'Makhoukh','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.33216 34.88112)')),
  (1057113928,'Cité Ezzitoune','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.34623 34.88170)')),
  (1064355235,'El Kifane','suburb',st_geogfromtext('SRID=4326;POINT(-1.33211 34.88968)')),
  (1161029591,'Bab Wahrane','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.31828 34.88368)')),
  (1161030543,'Centre Ville Historique','suburb',st_geogfromtext('SRID=4326;POINT(-1.30993 34.88257)')),
  (1161090226,'Lala Setti','suburb',st_geogfromtext('SRID=4326;POINT(-1.31809 34.86775)')),
  (1163395637,'Bastion 18','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.31710 34.87830)')),
  (1955915883,'El Mafrouche','village',st_geogfromtext('SRID=4326;POINT(-1.30505 34.85391)')),
  (2531129810,'Faubourg Bel-Air','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.32260 34.87603)')),
  (3110093634,'Tlemcen','city',st_geogfromtext('SRID=4326;POINT(-1.31670 34.88179)')),
  (3180446074,'Abou Tachfine','suburb',st_geogfromtext('SRID=4326;POINT(-1.32221 34.90661)')),
  (4195762898,'Kbasa','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.31958 34.88800)')),
  (4269964193,'Annahda','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.34156 34.88392)')),
  (4520491165,'Chetouane','town',st_geogfromtext('SRID=4326;POINT(-1.29106 34.92076)')),
  (4734198186,'Bouhannak','suburb',st_geogfromtext('SRID=4326;POINT(-1.36542 34.87852)')),
  (4734612915,'Oudjlida','suburb',st_geogfromtext('SRID=4326;POINT(-1.33107 34.92366)')),
  (4736460754,'Aïn El Houtz','village',st_geogfromtext('SRID=4326;POINT(-1.32588 34.93280)')),
  (4736472129,'Boudjlida','suburb',st_geogfromtext('SRID=4326;POINT(-1.34660 34.92144)')),
  (8988313018,'Cité Guermoni Siraj Abdel Jalil','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.35411 34.88594)')),
  (9016926558,'Cité 500 Logements','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.35845 34.88476)')),
  (9923391371,'El Riat','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.32812 34.86743)')),
  (9923407352,'El Koudia','suburb',st_geogfromtext('SRID=4326;POINT(-1.34883 34.91042)')),
  (9923415365,'El M''dig','village',st_geogfromtext('SRID=4326;POINT(-1.26430 34.89772)')),
  (10000037866,'Attar','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.33237 34.85846)')),
  (10002331627,'Sidi Saïd','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.31382 34.89019)')),
  (10002331628,'Feddan Sebaa','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.31647 34.89374)')),
  (10002382168,'Cité des Oliviers','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.32489 34.89669)')),
  (10002395911,'Sidi Boumediène','suburb',st_geogfromtext('SRID=4326;POINT(-1.28939 34.87946)')),
  (10010974186,'Aïn Defla','quarter',st_geogfromtext('SRID=4326;POINT(-1.28959 34.91018)')),
  (10011013123,'Sidi Aïssa','village',st_geogfromtext('SRID=4326;POINT(-1.26099 34.90267)')),
  (10018275706,'Boudjmil','village',st_geogfromtext('SRID=4326;POINT(-1.38754 34.86521)')),
  (10018300508,'Mlilia','village',st_geogfromtext('SRID=4326;POINT(-1.38600 34.91977)')),
  (10073987921,'Béni Boublène','village',st_geogfromtext('SRID=4326;POINT(-1.33890 34.86162)')),
  (10074001474,'Bab El Jiad','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.30622 34.88245)')),
  (10074005627,'El-Hartoun','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.30431 34.87856)')),
  (10085816790,'Riat El Hammar','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.30094 34.88099)')),
  (11801980185,'El Eubbad','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.29017 34.87760)')),
  (414448829,'Cité Nassim','neighbourhood',st_geogfromtext('SRID=4326;POINT(-1.33810 34.88671)'))
on conflict (osm_id) do nothing;

analyze osm_roads;
analyze osm_places;

select (select count(*) from osm_roads) as voies, (select count(*) from osm_places) as quartiers;
