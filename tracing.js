/**
 * tracing.js
 *
 * Must be loaded first via --require. Reads SERVICE_NAME from the environment
 * (set automatically by the start scripts) so a single file drives both services.
 *
 * Exporters: WinstonSpanExporter — spans are emitted as structured JSON log lines.
 */

"use strict";

const { NodeSDK } = require("@opentelemetry/sdk-node");
const {
  getNodeAutoInstrumentations,
} = require("@opentelemetry/auto-instrumentations-node");
const { SimpleSpanProcessor } = require("@opentelemetry/sdk-trace-node");
const {
  TraceIdRatioBasedSampler,
  ParentBasedSampler,
} = require("@opentelemetry/sdk-trace-base");
const winston = require("winston");
const WinstonSpanExporter = require("./SpanExporter");

const serviceName = process.env.SERVICE_NAME || "unknown-service";

// Dedicated logger for span export — kept separate from each service's app logger.
const spanLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

// Sample 10% of traces. ParentBased ensures that once a trace is sampled,
// all child spans within it are also kept (or dropped) consistently.
const sampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1),
});

const sdk = new NodeSDK({
  serviceName,
  sampler,
  spanProcessors: [new SimpleSpanProcessor(new WinstonSpanExporter(spanLogger))],
  instrumentations: [
    getNodeAutoInstrumentations({
      // Reduce noise: disable fs instrumentation (extremely chatty).
      "@opentelemetry/instrumentation-fs": { enabled: false },
      // Rename GraphQL HTTP spans from "POST /graphql" to the actual operation.
      // applyCustomAttributesOnSpan fires after the full response cycle, so
      // req.body is already populated by body-parser. The span is passed
      // directly — no map, no middleware ordering dependency.
      "@opentelemetry/instrumentation-http": {
        applyCustomAttributesOnSpan(span, request) {
          const body = request.body;
          console.log(request.baseUrl);
          console.log(request.url);
          
          if (!body?.query || (!request.baseUrl?.includes("/graphql") && !request.url?.includes("/graphql"))) return;

          const query = body.query.trim();
          const typeMatch = query.match(/^\s*(query|mutation|subscription)\b/);
          const opType = typeMatch ? typeMatch[1] : "query";

          if (body.operationName) {
            span.updateName(`${opType} ${body.operationName}`);
          } else {
            const fieldMatch = query.match(/\{\s*(\w+)/);
            if (fieldMatch) span.updateName(`${opType} ${fieldMatch[1]}`);
          }
        },
      },
    }),
  ],
});

sdk.start();
console.log(`[tracing] OpenTelemetry started for service: ${serviceName}`);

// Ensure spans are flushed on clean shutdown.
process.on("SIGTERM", () => sdk.shutdown().finally(() => process.exit(0)));
process.on("SIGINT", () => sdk.shutdown().finally(() => process.exit(0)));
