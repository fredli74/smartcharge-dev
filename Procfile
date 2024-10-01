web: node --max_old_space_size=384 --optimize_for_size dist/server/server.js --port=$PORT
worker: node dist/server/agency.js -d "$INTERNAL_SERVICE_TOKEN" "https://smartcharge-dev.herokuapp.com"