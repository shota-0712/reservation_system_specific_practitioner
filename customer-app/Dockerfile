FROM nginx:1.27-alpine

RUN apk add --no-cache gettext

COPY index.html /usr/share/nginx/html/index.html
COPY config.js /usr/share/nginx/html/config.js
COPY config.template.js /usr/share/nginx/html/config.template.js
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

ENV RESERVATION_API_URL=""
ENV RESERVATION_TENANT_KEY=""
ENV RESERVATION_ENABLE_MOCK="false"
ENV RESERVATION_BYPASS_LIFF="false"

EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
