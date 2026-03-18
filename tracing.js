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

// ---------------------------------------------------------------------------
// FilteringSpanProcessor — drops spans matching any rule before export.
//
// Each rule is a predicate: (span) => boolean.
// Return true to DROP the span, false to keep it.
//
// Examples:
//   (span) => span.name === "middleware - query"
//   (span) => span.name.startsWith("middleware")
//   (span) => span.attributes["http.target"] === "/healthz"
// ---------------------------------------------------------------------------
class FilteringSpanProcessor {
  constructor(delegate, shouldDrop) {
    this.delegate = delegate;
    this.shouldDrop = shouldDrop;
  }

  onStart(span, parentContext) {
    this.delegate.onStart(span, parentContext);
  }

  onEnd(span) {
    if (this.shouldDrop(span)) return;
    this.delegate.onEnd(span);
  }

  shutdown() { return this.delegate.shutdown(); }
  forceFlush() { return this.delegate.forceFlush(); }
}

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
const _baseSampler = new ParentBasedSampler({
  root: new TraceIdRatioBasedSampler(0.1),
});

// Wraps the sampler and logs every sampling decision — remove once verified.
const sampler = {
  shouldSample(ctx, traceId, name, spanKind, attributes, links) {
    const result = _baseSampler.shouldSample(ctx, traceId, name, spanKind, attributes, links);
    const { SamplingDecision } = require("@opentelemetry/sdk-trace-base");
    const decision = result.decision === SamplingDecision.RECORD_AND_SAMPLED ? "SAMPLED" : "DROPPED";
    console.log(`[sampler] ${decision} — span="${name}" traceId=${traceId}`);
    return result;
  },
  toString() { return _baseSampler.toString(); },
};

const sdk = new NodeSDK({
  serviceName,
  sampler,
  spanProcessors: [
    new FilteringSpanProcessor(
      new SimpleSpanProcessor(new WinstonSpanExporter(spanLogger)),
      // DROP rules — return true to discard the span.
      (span) =>
        span.name.startsWith("middleware") ||  // Express internal middleware spans
        span.name === "graphql.parse"        ||  // GraphQL parse phase
        span.name === "graphql.validate"         // GraphQL validate phase
    ),
  ],
  instrumentations: [
    getNodeAutoInstrumentations({
      // Reduce noise: disable fs instrumentation (extremely chatty).
      "@opentelemetry/instrumentation-fs": { enabled: false },
      // Disable all field resolver spans — only keep the top-level operation span.
      "@opentelemetry/instrumentation-graphql": {
        ignoreResolveSpans: true,
      },
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
