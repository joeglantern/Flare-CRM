FROM alpine:3.21
RUN apk add --no-cache postgresql17-client restic curl tzdata ca-certificates bash \
 && mkdir -p /backup/db /backup/state
COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
