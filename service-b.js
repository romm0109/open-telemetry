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
const { Pool } = require("pg");
const winston = require("winston");
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
  ],
});

// ---------------------------------------------------------------------------
// Postgres connection pool
// ---------------------------------------------------------------------------
const pool = new Pool({
  host: process.env.PGHOST || "localhost",
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
  database: process.env.PGDATABASE || "postgres",
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

      // The pg auto-instrumentation wraps pool.query and creates a child DB span
      // linked to the active HTTP server span — no manual code needed.
      const result = await pool.query("SELECT NOW() AS current_time");
      const currentTime = result.rows[0].current_time;

      logger.info("Service B: database query successful", {
        current_time: currentTime,
      });

      return currentTime;
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
