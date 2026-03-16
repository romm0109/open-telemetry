/**
 * otel-web.ts — Browser OTel initializer (React & Angular compatible)
 *
 * Import this as the FIRST line of main.tsx / main.ts so the monkey-patching
 * of window.fetch and XMLHttpRequest happens before any requests are made.
 *
 * What this does:
 *   - Patches window.fetch and XMLHttpRequest globally.
 *   - Injects a W3C `traceparent` header into every outgoing request.
 *   - Downstream services (Node/OTel) read that header and continue the same trace.
 *   - No spans are exported — no collector needed.
 *
 * Usage (React):
 *   // main.tsx
 *   import { initTracing } from './otel-web';
 *   initTracing({ propagateUrls: [/localhost:3001/] });
 *
 * Usage (Angular):
 *   // main.ts
 *   import { initTracing } from './otel-web';
 *   initTracing({ propagateUrls: [/localhost:3001/] });
 *
 * Install:
 *   npm install \
 *     @opentelemetry/sdk-trace-web \
 *     @opentelemetry/resources \
 *     @opentelemetry/semantic-conventions \
 *     @opentelemetry/core \
 *     @opentelemetry/instrumentation \
 *     @opentelemetry/instrumentation-fetch \
 *     @opentelemetry/instrumentation-xml-http-request
 */

import { WebTracerProvider, StackContextManager } from "@opentelemetry/sdk-trace-web";
import {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} from "@opentelemetry/core";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { XMLHttpRequestInstrumentation } from "@opentelemetry/instrumentation-xml-http-request";

export interface TracingOptions {
  /**
   * URL patterns that should receive the traceparent header.
   * Required for cross-origin requests (CORS). Defaults to all URLs.
   * Example: [/api\.mybackend\.com/, /localhost:3001/]
   */
  propagateUrls?: RegExp[];
}

export function initTracing(options: TracingOptions): void {
  const { propagateUrls = [/.*/] } = options;

  const provider = new WebTracerProvider({
    // No span processors — spans exist only to carry trace context.
    // Nothing is exported, no collector is needed.
  });

  provider.register({
    // StackContextManager works in both React and Angular without Zone.js.
    // Angular users: swap to ZoneContextManager from @opentelemetry/context-zone
    // for better async context propagation through RxJS and change detection.
    contextManager: new StackContextManager(),
    propagator: new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(), // injects traceparent + tracestate
        new W3CBaggagePropagator(),      // injects baggage (optional key-value metadata)
      ],
    }),
  });

  registerInstrumentations({
    tracerProvider: provider,
    instrumentations: [
      // Patches window.fetch globally.
      new FetchInstrumentation({
        propagateTraceHeaderCorsUrls: propagateUrls,
      }),
      // Patches XMLHttpRequest globally (also covers Axios in browsers).
      new XMLHttpRequestInstrumentation({
        propagateTraceHeaderCorsUrls: propagateUrls,
      }),
    ],
  });
}
