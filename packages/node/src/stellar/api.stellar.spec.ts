// Copyright 2020-2026 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { StellarApi } from './api.stellar';
import { SorobanServer } from './soroban.server';

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

  it('handles a transaction with multiple operations and events', async () => {
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
