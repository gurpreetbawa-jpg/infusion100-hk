#!/bin/bash
# Local PostgreSQL start/stop helper
# Usage: ./pg.sh start | stop | status

PGDATA="/opt/homebrew/var/postgresql@14"

case "$1" in
  start)
    pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" start
    ;;
  stop)
    pg_ctl -D "$PGDATA" stop
    ;;
  status)
    pg_ctl -D "$PGDATA" status
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
