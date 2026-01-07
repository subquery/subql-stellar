// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {
  ApiConnectionError,
  ApiErrorType,
  DisconnectionError,
  LargeResponseError,
  RateLimitError,
  TimeoutError,
} from '@subql/node-core';
import {StellarBlock, StellarBlockWrapper} from '@subql/types-stellar';
import {StellarApiConnection} from './api.connection';
import {StellarApi} from './api.stellar';

const SOROBAN_ENDPOINT = 'https://rpc-futurenet.stellar.org';

describe('StellarApiConnection', () => {
  let apiConnection: StellarApiConnection;
  let unsafeApi: StellarApi;
  const mockBlocks: StellarBlockWrapper[] = [
    {
      block: {sequence: 1, hash: 'hash1'} as unknown as StellarBlock,
      transactions: [],
      operations: [],
      events: [],
    },
    {
      block: {sequence: 2, hash: 'hash2'} as unknown as StellarBlock,
      transactions: [],
      operations: [],
      events: [],
    },
  ];

  const fetchBlockBatches = jest.fn().mockResolvedValue(mockBlocks);

  beforeEach(async () => {
    unsafeApi = new StellarApi(SOROBAN_ENDPOINT);
    await unsafeApi.init();
    apiConnection = new StellarApiConnection(unsafeApi, fetchBlockBatches);
  });

  it('creates a connection', async () => {
    expect(await StellarApiConnection.create(fetchBlockBatches, SOROBAN_ENDPOINT)).toBeInstanceOf(StellarApiConnection);
  });

  it('fetches blocks', async () => {
    const result = await apiConnection.fetchBlocks([1, 2]);
    expect(result).toEqual(mockBlocks);
    expect(fetchBlockBatches).toHaveBeenCalledWith(unsafeApi, [1, 2]);
  });

  describe('Error handling', () => {
    it('handles timeout errors', () => {
      const error = new Error('Timeout');
      const handledError = StellarApiConnection.handleError(error);
      expect(handledError).toBeInstanceOf(TimeoutError);
    });

    it('handles disconnection errors', () => {
      const error = new Error('disconnected from ');
      const handledError = StellarApiConnection.handleError(error);
      expect(handledError).toBeInstanceOf(DisconnectionError);
    });

    it('handles rate limit errors', () => {
      const error = new Error('Rate Limit Exceeded');
      const handledError = StellarApiConnection.handleError(error);
      expect(handledError).toBeInstanceOf(RateLimitError);
    });

    it('handles large response errors', () => {
      const error = new Error('limit must not exceed');
      const handledError = StellarApiConnection.handleError(error);
      expect(handledError).toBeInstanceOf(LargeResponseError);
    });

    it('handles default errors', () => {
      const error = new Error('default error');
      const handledError = StellarApiConnection.handleError(error);
      expect(handledError).toBeInstanceOf(ApiConnectionError);
      expect(handledError.errorType).toEqual(ApiErrorType.Default);
    });
  });
});
