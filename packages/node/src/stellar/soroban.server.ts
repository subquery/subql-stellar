// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { rpc } from '@stellar/stellar-sdk';
import { SorobanRpcEventResponse } from '@subql/types-stellar';
import { compact, groupBy, last } from 'lodash';
import { DEFAULT_PAGE_SIZE } from './utils.stellar';

type CachedEventsResponse = Pick<
  rpc.Api.GetEventsResponse,
  'events' | 'latestLedger'
>;

export class SorobanServer extends rpc.Server {
  private eventsCache: { [key: number]: rpc.Api.GetEventsResponse } = {};

  private async fetchEventsForSequence(
    sequence: number,
    request: rpc.Server.GetEventsRequest,
    accEvents: SorobanRpcEventResponse[] = [],
  ): Promise<{
    events: CachedEventsResponse;
    eventsToCache: CachedEventsResponse;
  }> {
    const pageLimit = request.limit ?? DEFAULT_PAGE_SIZE;
    const response = await super.getEvents(request);

    // Separate the events for the current sequence and the subsequent sequences
    const groupedEvents = groupBy(response.events, (event) =>
      event.ledger === sequence ? 'events' : 'eventsToCache',
    );
    const events = compact(groupedEvents.events);
    let eventsToCache = compact(groupedEvents.eventsToCache);

    // Update the accumulated events with the events from the current sequence
    const newEvents = accEvents.concat(events);

    // Gone over the current sequence, we must have all events
    if (eventsToCache?.length) {
      // Exclude the events to cache from the last sequence, we probably don't have all the events for that sequence so we discard them
      if (response.events.length === pageLimit) {
        const lastSequence = last(response.events)!.ledger;
        eventsToCache = eventsToCache.filter(
          (event) => event.ledger !== lastSequence,
        );
      }
      return {
        events: { events: newEvents, latestLedger: response.latestLedger },
        eventsToCache: {
          events: eventsToCache,
          latestLedger: response.latestLedger,
        },
      };
    }
    // We cannot check response.events.length < pageLimit here because the server may have a pageLimit below ours that it will use.

    // Prepare the next request
    const nextRequest = {
      ...request,
      cursor: response.cursor,
      startLedger: undefined,
      endLedger: undefined,
    };

    // Continue fetching events for the sequence
    return this.fetchEventsForSequence(sequence, nextRequest, newEvents);
  }

  private updateEventCache(
    response: CachedEventsResponse,
    ignoreHeight?: number,
  ): void {
    response.events.forEach((event) => {
      if (ignoreHeight && ignoreHeight === event.ledger) return;
      const ledger = event.ledger;
      if (!this.eventsCache[ledger]) {
        this.eventsCache[ledger] = {
          events: [],
          latestLedger: response.latestLedger,
        } as unknown as rpc.Api.GetEventsResponse;
      }
      const eventExists = this.eventsCache[ledger].events.some(
        (existingEvent) => existingEvent.id === event.id,
      );
      if (!eventExists) {
        this.eventsCache[ledger].events.push(event);
      }
    });
  }

  async getEvents(
    request: rpc.Server.GetEventsRequest,
  ): Promise<rpc.Api.GetEventsResponse> {
    const sequence = request.startLedger;

    if (sequence === undefined) {
      throw new Error(`Get soraban event failed, block sequence is missing`);
    }

    // Set a limit on the request range, endLedger is exclusive
    request.endLedger = request.endLedger ?? sequence + 1;

    if (this.eventsCache[sequence]) {
      const cachedEvents = this.eventsCache[sequence];
      delete this.eventsCache[sequence];
      return cachedEvents;
    }

    const response = await this.fetchEventsForSequence(sequence, request);
    this.updateEventCache(response.eventsToCache, sequence);

    return response.events as rpc.Api.GetEventsResponse;
  }
}
