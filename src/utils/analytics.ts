import { track as trackGTM } from '@labring/sealos-gtm-sdk';
import type { GTMEvent, GTMEventType } from '@labring/sealos-gtm-sdk';

const MAX_RYBBIT_PROPERTY_LENGTH = 512;

type ExtractEventByType<T extends GTMEventType> = Extract<GTMEvent, { event: T }>;
type EventProperties<T extends GTMEventType> = Omit<ExtractEventByType<T>, 'event' | 'context'>;

interface RybbitQueuedEvent {
  event: string;
  properties: Record<string, string | number>;
}

interface RybbitApi {
  event: (eventName: string, properties?: Record<string, string | number>) => void;
}

declare global {
  interface Window {
    rybbit?: RybbitApi;
  }
}

const rybbitQueue: RybbitQueuedEvent[] = [];

function forwardToRybbit(gtmEvent: GTMEvent): void {
  if (typeof window === 'undefined') return;

  const { event, ...payload } = gtmEvent;
  const properties: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) continue;

    const serialized =
      typeof value === 'string' || typeof value === 'number' ? value : JSON.stringify(value);
    if (serialized === undefined) continue;

    properties[key] =
      typeof serialized === 'string' && serialized.length > MAX_RYBBIT_PROPERTY_LENGTH
        ? serialized.slice(0, MAX_RYBBIT_PROPERTY_LENGTH)
        : serialized;
  }

  if (typeof window.rybbit?.event !== 'function') {
    rybbitQueue.push({ event, properties });
    return;
  }

  window.rybbit.event(event, properties);
}

export function track(event: Readonly<GTMEvent>): void;
export function track<T extends GTMEventType>(
  eventType: T,
  properties?: Readonly<EventProperties<T>>
): void;
export function track<T extends GTMEventType>(
  eventOrType: Readonly<GTMEvent> | T,
  properties?: Readonly<EventProperties<T>>
): void {
  trackGTM(eventOrType as never, properties as never);

  const gtmEvent: GTMEvent =
    typeof eventOrType === 'string'
      ? ({ event: eventOrType, context: 'app', ...properties } as GTMEvent)
      : { ...eventOrType, context: eventOrType.context || 'app' };

  forwardToRybbit(gtmEvent);
}

export function flushRybbitQueue(): void {
  if (typeof window === 'undefined' || typeof window.rybbit?.event !== 'function') return;

  while (rybbitQueue.length > 0) {
    const queued = rybbitQueue.shift();
    if (queued) {
      window.rybbit.event(queued.event, queued.properties);
    }
  }
}
