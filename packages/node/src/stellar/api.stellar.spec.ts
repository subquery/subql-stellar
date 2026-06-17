// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { delay } from '@subql/node-core';
import { StellarApi } from './api.stellar';
import { SorobanServer } from './soroban.server';

jest.mock('@subql/node-core', () => ({
  ...jest.requireActual('@subql/node-core'),
  delay: jest.fn(() => Promise.resolve()),
}));

const HTTP_ENDPOINT = 'https://horizon-futurenet.stellar.org';
const SOROBAN_ENDPOINT = 'https://rpc-futurenet.stellar.org';

jest.setTimeout(60000);

const prepareStellarApi = async function (
  stellarEndpoint = HTTP_ENDPOINT,
  sorobanEndpoint = SOROBAN_ENDPOINT,
) {
  const soroban = new SorobanServer(sorobanEndpoint);
  const api = new StellarApi(stellarEndpoint, soroban);
  await api.init();
  return api;
};

describe('StellarApi', () => {
  let stellarApi: StellarApi;

  beforeEach(async () => {
    stellarApi = await prepareStellarApi();
  });

  it('should initialize chainId', () => {
    expect(stellarApi.getChainId()).toEqual(
      'Test SDF Future Network ; October 2022',
    );
  });

  it('should get finalized block height', async () => {
    const height = await stellarApi.getFinalizedBlockHeight();
    expect(height).not.toBeNaN();
    expect(height).toBeGreaterThan(0);
  });

  it('should get best block height', async () => {
    const height = await stellarApi.getBestBlockHeight();
    expect(height).not.toBeNaN();
    expect(height).toBeGreaterThan(0);
  });

  it('should fetch block', async () => {
    const latestHeight = await stellarApi.getFinalizedBlockHeight();
    const block = (await stellarApi.fetchBlocks([latestHeight]))[0];
    expect(block.getHeader().blockHeight).toEqual(latestHeight);
  });

  it('should throw on calling connect', async () => {
    await expect(stellarApi.connect()).rejects.toThrow('Not implemented');
  });

  it('should throw on calling disconnect', async () => {
    await expect(stellarApi.disconnect()).rejects.toThrow('Not implemented');
  });

  it('handleError - pruned node errors', () => {
    const error = new Error('start is before oldest ledger');
    const handled = stellarApi.handleError(error, 1000);
    expect(handled.message).toContain(
      'The requested ledger number 1000 is not available on the current blockchain node',
    );
  });

  it('handleError - non pruned node errors should return the same error', () => {
    const error = new Error('Generic error');
    const handled = stellarApi.handleError(error, 1000);
    expect(handled).toBe(error);
  });

  it('should get runtime chain', () => {
    const runtimeChain = stellarApi.getRuntimeChain();
    expect(runtimeChain).toEqual((stellarApi as any).chainId);
  });

  it('should return chainId for genesis hash', () => {
    const genesisHash = stellarApi.getGenesisHash();
    expect(genesisHash).toEqual(stellarApi.getChainId());
  });

  it('should get spec name', () => {
    const specName = stellarApi.getSpecName();
    expect(specName).toEqual('Stellar');
  });

  it('handleError - soroban node been reset', async () => {
    const error = new Error('start is after newest ledger');
    stellarApi.getAndWrapEvents = jest.fn(() => {
      throw new Error('start is after newest ledger');
    });
    (stellarApi as any).fetchOperationsForLedger = jest.fn((seq: number) => [
      { type: { toString: () => 'invoke_host_function' } },
    ]);
    await expect((stellarApi as any).fetchAndWrapLedger(100)).rejects.toThrow(
      /(Gone|Not Found)/,
    );
  });

  // TODO: Re-enable with valid testnet data or mocked responses
  // Skipped because the specific transaction hash is not found in block 466592
  // Testnet may have been reset or the transaction hash/block number is outdated
  it.skip('handles a transaction with multiple operations and events', async () => {
    const api = await prepareStellarApi(
      'https://horizon-testnet.stellar.org',
      'https://soroban-testnet.stellar.org',
    );

    const [block] = await api.fetchBlocks([466592]);

    const tx = block.block.transactions.find(
      (tx) =>
        tx.hash ===
        '7967828275a8ba2442a0d4d21e8052b77ec87e8601598173e8857ad96c135685',
    );

    expect(tx).toBeDefined();

    expect(tx?.operations.length).toEqual(4);
    expect(tx?.events.length).toEqual(2);

    // Events should be correctly assigned to operations
    expect(tx?.operations[0].events.length).toEqual(1);
    expect(tx?.operations[1].events.length).toEqual(1);
    expect(tx?.operations[2].events.length).toEqual(0);
    expect(tx?.operations[3].events.length).toEqual(0);
  });
});

describe('StellarApi soroban ingestion lag', () => {
  const mockedDelay = delay as unknown as jest.Mock;

  const rangeError = (lo: number, hi: number) => ({
    code: -32600,
    message: `startLedger must be within the ledger range: ${lo} - ${hi}`,
  });

  const makeApi = (soroban: any, waitSeconds?: number) =>
    new StellarApi(HTTP_ENDPOINT, soroban as SorobanServer, {
      sorobanIngestWaitSeconds: waitSeconds,
    });

  beforeEach(() => {
    mockedDelay.mockClear();
  });

  it('waits for the soroban endpoint to ingest the ledger then recovers', async () => {
    let calls = 0;
    const soroban = {
      getEvents: jest.fn(({ startLedger }: { startLedger: number }) => {
        calls++;
        if (calls <= 2) return Promise.reject(rangeError(100, startLedger - 1));
        return Promise.resolve({
          events: [
            { ledger: startLedger, id: 'e1', operationIndex: 0, txHash: 't1' },
          ],
          latestLedger: startLedger,
        });
      }),
    };
    const api = makeApi(soroban);

    const events = await (api as any).getEventsWhenIngested(200);

    expect(soroban.getEvents).toHaveBeenCalledTimes(3);
    expect(mockedDelay).toHaveBeenCalledTimes(2);
    expect(events).toHaveLength(1);
    expect(events[0].id).toEqual('e1');
  });

  it('rethrows immediately when the ledger is below the retention window', async () => {
    const soroban = {
      getEvents: jest.fn(() => Promise.reject(rangeError(1000, 2000))),
      getLatestLedger: jest.fn(() => Promise.resolve({ sequence: 2000 })),
    };
    const api = makeApi(soroban);

    await expect((api as any).getEventsWhenIngested(500)).rejects.toMatchObject(
      {
        code: -32600,
      },
    );
    expect(soroban.getEvents).toHaveBeenCalledTimes(1);
    expect(mockedDelay).not.toHaveBeenCalled();
  });

  it('keeps the explanatory error for the legacy oldest-ledger message', async () => {
    const soroban = {
      getEvents: jest.fn(() =>
        Promise.reject(new Error('start is before oldest ledger')),
      ),
    };
    const api = makeApi(soroban);

    await expect((api as any).getEventsWhenIngested(500)).rejects.toThrow(
      'older than the oldest ledger',
    );
    expect(mockedDelay).not.toHaveBeenCalled();
  });

  it('treats the legacy after-newest-ledger message as transient', async () => {
    let calls = 0;
    const soroban = {
      getEvents: jest.fn(({ startLedger }: { startLedger: number }) => {
        calls++;
        if (calls === 1) {
          return Promise.reject(new Error('start is after newest ledger'));
        }
        return Promise.resolve({ events: [], latestLedger: startLedger });
      }),
    };
    const api = makeApi(soroban);

    const events = await (api as any).getEventsWhenIngested(200);

    expect(events).toEqual([]);
    expect(soroban.getEvents).toHaveBeenCalledTimes(2);
  });

  it('falls back to getLatestLedger for a -32600 with unknown wording', async () => {
    let calls = 0;
    const soroban = {
      getEvents: jest.fn(({ startLedger }: { startLedger: number }) => {
        calls++;
        if (calls === 1) {
          return Promise.reject({
            code: -32600,
            message: `startLedger ${startLedger} exceeds latest ledger`,
          });
        }
        return Promise.resolve({ events: [], latestLedger: startLedger });
      }),
      getLatestLedger: jest.fn(() => Promise.resolve({ sequence: 199 })),
    };
    const api = makeApi(soroban);

    const events = await (api as any).getEventsWhenIngested(200);

    expect(events).toEqual([]);
    expect(soroban.getEvents).toHaveBeenCalledTimes(2);
    expect(soroban.getLatestLedger).toHaveBeenCalled();
  });

  it('rethrows a genuine -32600 when the soroban head is ahead of the sequence', async () => {
    const soroban = {
      getEvents: jest.fn(() =>
        Promise.reject({ code: -32600, message: 'some other invalid request' }),
      ),
      getLatestLedger: jest.fn(() => Promise.resolve({ sequence: 500 })),
    };
    const api = makeApi(soroban);

    await expect((api as any).getEventsWhenIngested(200)).rejects.toMatchObject(
      {
        message: 'some other invalid request',
      },
    );
    expect(soroban.getEvents).toHaveBeenCalledTimes(1);
    expect(mockedDelay).not.toHaveBeenCalled();
  });

  it('rethrows once the wait deadline is exhausted', async () => {
    const soroban = {
      getEvents: jest.fn(({ startLedger }: { startLedger: number }) =>
        Promise.reject(rangeError(100, startLedger - 1)),
      ),
    };
    const api = makeApi(soroban, 0);

    await expect((api as any).getEventsWhenIngested(200)).rejects.toMatchObject(
      {
        code: -32600,
      },
    );
    expect(soroban.getEvents).toHaveBeenCalledTimes(1);
    expect(mockedDelay).not.toHaveBeenCalled();
  });

  it('wires the wait loop into fetchAndWrapLedger', async () => {
    let calls = 0;
    const soroban = {
      getEvents: jest.fn(({ startLedger }: { startLedger: number }) => {
        calls++;
        if (calls === 1) {
          return Promise.reject(rangeError(100, startLedger - 1));
        }
        return Promise.resolve({
          events: [
            { ledger: startLedger, id: 'e9', operationIndex: 0, txHash: 't1' },
          ],
          latestLedger: startLedger,
        });
      }),
    };
    const api = makeApi(soroban);

    const emptyPage: any = {
      records: [],
      next: () => Promise.resolve(emptyPage),
    };
    (api as any).stellarClient = {
      ledgers: () => ({
        ledger: () => ({
          call: () => Promise.resolve({ sequence: 300, hash: 'abc' }),
        }),
      }),
      transactions: () => ({
        forLedger: () => ({
          limit: () => ({ call: () => Promise.resolve(emptyPage) }),
        }),
      }),
      operations: () => ({
        forLedger: () => ({
          limit: () => ({
            call: () =>
              Promise.resolve({
                records: [
                  {
                    type: 'invoke_host_function',
                    id: '1',
                    transaction_hash: 't1',
                  },
                ],
                next: () => Promise.resolve(emptyPage),
              }),
          }),
        }),
      }),
      effects: () => ({
        forLedger: () => ({
          limit: () => ({ call: () => Promise.resolve(emptyPage) }),
        }),
      }),
    };

    const block = await (api as any).fetchAndWrapLedger(300);

    expect(soroban.getEvents).toHaveBeenCalledTimes(2);
    expect(block.block.events).toHaveLength(1);
    expect(block.block.events[0].id).toEqual('e9');
  });
});
