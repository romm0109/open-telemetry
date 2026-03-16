/**
 * service-a.js  —  API Gateway (port 3001)
 *
 * Receives GET /fetch, logs the request, then sends a GraphQL query to Service B.
 * The OTel HTTP instrumentation automatically:
 *   1. Creates a server span for the incoming request.
 *   2. Injects W3C traceparent / tracestate headers into the outgoing request,
 *      so Service B continues the same trace.
 *
 * @opentelemetry/winston-transport enriches every Winston log entry with
 * trace_id and span_id from the currently active span context.
 */

"use strict";

const express = require("express");
const http = require("http");
const winston = require("winston");
const {
  OpenTelemetryTransportV3,
} = require("@opentelemetry/winston-transport");

// ---------------------------------------------------------------------------
// Logger — JSON output + OTel transport for trace_id / span_id injection
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  // OpenTelemetryTransportV3 hooks into Winston and adds trace context fields
  // (trace_id, span_id, trace_flags) to every log record when a span is active.
  transports: [
    new winston.transports.Console(),
    new OpenTelemetryTransportV3(),
  ],
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();
const PORT = 3001;
const SERVICE_B_URL = process.env.SERVICE_B_URL || "http://localhost:3002";

app.get("/fetch", (req, res) => {
  logger.info("Service A: received /fetch request", {
    method: req.method,
    path: req.path,
  });

  // GraphQL query sent to Service B.
  const gqlBody = JSON.stringify({ query: "{ dbTime }" });

  const url = new URL("/graphql", SERVICE_B_URL);
  const options = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(gqlBody),
    },
  };

  // The auto-instrumentation wraps http.request and injects the traceparent
  // header, continuing the distributed trace automatically — no manual
  // propagation needed.
  const proxyReq = http.request(url.toString(), options, (proxyRes) => {
    let body = "";
    proxyRes.on("data", (chunk) => (body += chunk));
    proxyRes.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        parsed = { raw: body };
      }

      logger.info("Service A: received GraphQL response from Service B", {
        statusCode: proxyRes.statusCode,
        body: parsed,
      });

      res.json({
        gateway: "service-a",
        upstream: parsed?.data ?? parsed,
      });
    });
  });

  proxyReq.on("error", (err) => {
    logger.error("Service A: failed to reach Service B", {
      error: err.message,
    });
    res.status(502).json({ error: "upstream request failed" });
  });

  proxyReq.write(gqlBody);
  proxyReq.end();
});

app.listen(PORT, () => {
  logger.info(`Service A listening`, { port: PORT });
});
