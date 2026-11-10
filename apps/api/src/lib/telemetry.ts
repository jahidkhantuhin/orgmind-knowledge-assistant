import { SpanStatusCode, trace, type Span, type SpanOptions } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let sdk: NodeSDK | undefined;

export function startTelemetry(): void {
  if (!env.OTEL_EXPORTER_OTLP_ENDPOINT) return;
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/$/, '');
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
  });
  sdk.start();
  logger.info({ endpoint }, 'OpenTelemetry trace export enabled');
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) await sdk.shutdown();
}

export async function withSpan<T>(
  name: string,
  callback: (_span: Span) => Promise<T>,
  attributes: SpanOptions['attributes'] = {},
): Promise<T> {
  const tracer = trace.getTracer('orgmind-api');
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      return await callback(span);
    } catch (error) {
      span.recordException(error instanceof Error ? error : String(error));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}

export function activeTraceId(): string | undefined {
  const id = trace.getActiveSpan()?.spanContext().traceId;
  return id && id !== '00000000000000000000000000000000' ? id : undefined;
}
