class WinstonSpanExporter {
    constructor(winstonLogger) {
        this.logger = winstonLogger;
    }

    export(spans, resultCallback) {
        for (const span of spans) {

            // Build your minimal span object just like before
            const isServiceEntrySpan = span.kind === 1;

            const minimalSpan = {
                event_type: "otel_span",
                otel_trace_id: span.spanContext().traceId,
                otel_span_id: span.spanContext().spanId,
                otel_name: span.name,
                // If it's the entry span, this duration is the total time THIS service spent
                duration_ms: (span.duration[0] * 1000) + (span.duration[1] / 1000000),
                is_service_total_duration: isServiceEntrySpan, // Our updated flag!
                attributes: span.attributes
            };

            // 2. Pass the object directly to Winston as metadata!
            this.logger.info('OpenTelemetry Span Exported', { minimalSpan });
        }

        // Tell OpenTelemetry the export was successful
        resultCallback({ code: 0 });
    }

    shutdown() { return Promise.resolve(); }
}

module.exports = WinstonSpanExporter;