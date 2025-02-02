FROM postgres:15

COPY deploy/postgres-init.sql /docker-entrypoint-initdb.d/init.sql
COPY deploy/postgres-entrypoint.sh /usr/local/bin/custom-entrypoint.sh
RUN chmod +x /usr/local/bin/custom-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/custom-entrypoint.sh"]
CMD ["postgres"]
