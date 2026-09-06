/**
 * Prometheus exposition without a dependency (docs/12 §7). Internal network only.
 * Tracks HTTP requests, screen-pop latency, PBX connection, queue depths and socket connections.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { readCtiStatus } from '../integrations/yeastar/subscriber.js';
import { QUEUES } from '../jobs/queues.js';

const POP_BUCKETS = [100, 250, 500, 1000, 2000, 5000];

export default fp(
  function metricsPlugin(app: FastifyInstance) {
    const httpCounts = new Map<string, number>();
    let httpTotalMs = 0;
    let httpTotal = 0;

    app.addHook('onResponse', (request, reply, done) => {
      const route = request.routeOptions.url ?? 'unknown';
      if (route !== '/metrics' && route !== '/health') {
        const key = `${request.method}|${route}|${String(reply.statusCode)}`;
        httpCounts.set(key, (httpCounts.get(key) ?? 0) + 1);
        httpTotal++;
        httpTotalMs += reply.elapsedTime;
      }
      done();
    });

    app.get(
      '/metrics',
      { config: { auth: { public: true } }, schema: { hide: true }, logLevel: 'silent' },
      async (request, reply) => {
        if (!app.config.METRICS_ENABLED) return reply.status(404).send('');
        const ip = request.ip;
        const internal =
          /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|::ffff:(127|10|192\.168)\.)/.test(
            ip,
          );
        if (!internal && app.config.NODE_ENV === 'production') return reply.status(404).send('');

        const lines: string[] = [];
        lines.push('# TYPE crm_http_requests_total counter');
        for (const [key, count] of httpCounts) {
          const [method, route, status] = key.split('|');
          lines.push(
            `crm_http_requests_total{method="${method}",route="${route}",status="${status}"} ${String(count)}`,
          );
        }
        lines.push(
          '# TYPE crm_http_request_duration_ms_sum counter',
          `crm_http_request_duration_ms_sum ${httpTotalMs.toFixed(1)}`,
          `crm_http_request_duration_ms_count ${String(httpTotal)}`,
        );

        const pops = app.cti.popLatencies;
        lines.push('# TYPE crm_cti_pop_latency_ms histogram');
        for (const b of POP_BUCKETS) {
          lines.push(
            `crm_cti_pop_latency_ms_bucket{le="${String(b)}"} ${String(pops.filter((p) => p <= b).length)}`,
          );
        }
        lines.push(
          `crm_cti_pop_latency_ms_bucket{le="+Inf"} ${String(pops.length)}`,
          `crm_cti_pop_latency_ms_sum ${String(pops.reduce((a, b) => a + b, 0))}`,
          `crm_cti_pop_latency_ms_count ${String(pops.length)}`,
        );

        const status = await readCtiStatus(app.valkey);
        lines.push(
          '# TYPE crm_cti_connected gauge',
          `crm_cti_connected ${status.connected ? '1' : '0'}`,
        );
        lines.push(
          '# TYPE crm_cti_live_calls gauge',
          `crm_cti_live_calls ${String((await app.cti.machine.liveCalls()).length)}`,
        );

        lines.push('# TYPE crm_queue_jobs gauge');
        for (const name of Object.values(QUEUES)) {
          try {
            const counts = await app.queues
              .get(name)
              .getJobCounts('waiting', 'active', 'delayed', 'failed');
            for (const [state, n] of Object.entries(counts))
              lines.push(`crm_queue_jobs{queue="${name}",state="${state}"} ${String(n)}`);
          } catch {
            // queue not reachable — omit rather than fail the scrape
          }
        }

        if (app.hasDecorator('io')) {
          lines.push(
            '# TYPE crm_socket_connections gauge',
            `crm_socket_connections ${String(app.io.engine.clientsCount)}`,
          );
        }
        lines.push(
          '# TYPE crm_process_heap_bytes gauge',
          `crm_process_heap_bytes ${String(process.memoryUsage().heapUsed)}`,
        );
        void reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8');
        return reply.send(`${lines.join('\n')}\n`);
      },
    );
  },
  { name: 'metrics', dependencies: ['cti', 'queues'] },
);
