FROM postgis/postgis:16-3.4

COPY bootstrap-roles.sh /docker-entrypoint-initdb.d/001_bootstrap_roles.sh
COPY schema-v2.sql /docker-entrypoint-initdb.d/002_schema_v2.sql
COPY migrate.sh /usr/local/bin/sentinel-migrate
COPY migrations-v2 /migrations-v2

RUN chmod 0755 /docker-entrypoint-initdb.d/001_bootstrap_roles.sh /usr/local/bin/sentinel-migrate
