ARG POSTGRES_MAJOR=17
FROM pgvector/pgvector:0.8.6-pg17-bookworm AS vector-runtime

FROM apache/age:release_PG17_1.7.0

ARG POSTGRES_MAJOR
COPY --from=vector-runtime /usr/lib/postgresql/${POSTGRES_MAJOR}/lib/vector.so /usr/lib/postgresql/${POSTGRES_MAJOR}/lib/vector.so
COPY --from=vector-runtime /usr/share/postgresql/${POSTGRES_MAJOR}/extension/vector* /usr/share/postgresql/${POSTGRES_MAJOR}/extension/
COPY --from=vector-runtime /usr/share/doc/pgvector /usr/share/doc/pgvector
