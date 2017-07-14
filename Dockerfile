
FROM keymetrics/pm2-docker-alpine:6

ADD app/ /opt/tournament-service/

WORKDIR /opt/tournament-service

RUN npm install

CMD ["pm2-docker", "start", "--auto-exit", "--env", "production", "pm2.json"]