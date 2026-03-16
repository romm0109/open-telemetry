/**
 * service-b.js  —  Data Service (port 3002) — GraphQL
 *
 * Exposes a GraphQL endpoint at POST /graphql.
 * Resolves the `dbTime` query by running SELECT NOW() against Postgres.
 *
 * The OTel HTTP instrumentation reads the traceparent header forwarded by
 * Service A and automatically resumes the same trace (same trace_id, new
 * child span_id). The pg instrumentation adds a child DB span automatically.
 */

"use strict";

const express = require("express");
const winston = require("winston");
const { OpenTelemetryTransportV3 } = require("@opentelemetry/winston-transport");
const { ApolloServer } = require("@apollo/server");
const { expressMiddleware } = require("@apollo/server/express4");
const bodyParser = require("body-parser");

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new OpenTelemetryTransportV3(),
  ],
});

// ---------------------------------------------------------------------------
// GraphQL schema + resolvers
// ---------------------------------------------------------------------------
const typeDefs = `
  type Query {
    dbTime: String
  }
`;

const resolvers = {
  Query: {
    dbTime: async (_parent, _args, context) => {
      logger.info("Service B: resolving dbTime query", {
        traceparent: context.traceparent ?? null,
      });

      throw new Error("Simulated failure in dbTime resolver");
    },
  },
};

// ---------------------------------------------------------------------------
// Express + Apollo Server
// ---------------------------------------------------------------------------
const app = express();
const PORT = 3002;

async function start() {
  const server = new ApolloServer({ typeDefs, resolvers });
  await server.start();

  app.use(
    "/graphql",
    bodyParser.json(),
    expressMiddleware(server, {
      // Pass the raw traceparent header into GraphQL context so resolvers can log it.
      context: async ({ req }) => ({
        traceparent: req.headers["traceparent"] ?? null,
      }),
    })
  );

  app.listen(PORT, () => {
    logger.info(`Service B listening (GraphQL at /graphql)`, { port: PORT });
  });
}

start().catch((err) => {
  logger.error("Service B: failed to start", { error: err.message });
  process.exit(1);
});
