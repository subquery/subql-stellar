// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {StellarApi} from './api.stellar';
import {StellarBlockWrapped} from './block.stellar';
import {nativeToScVal, scValToNative, xdr} from '@stellar/stellar-sdk';

const SOROBAN_ENDPOINT = 'https://rpc-futurenet.stellar.org';

jest.setTimeout(60000);

const prepareStellarApi = async function (sorobanEndpoint = SOROBAN_ENDPOINT) {
  const api = new StellarApi(sorobanEndpoint);
  await api.init();
  return api;
};

describe('StellarApi', () => {
  let stellarApi: StellarApi;

  beforeEach(async () => {
    stellarApi = await prepareStellarApi();
  });

  it('should initialize chainId', () => {
    expect(stellarApi.getChainId()).toEqual('Test SDF Future Network ; October 2022');
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

  // Note this test can have a high chance of failure because of load balancers
  it('should fetch block', async () => {
    const latestHeight = await stellarApi.getFinalizedBlockHeight();
    const [block] = await stellarApi.fetchBlocks([latestHeight]);
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
    stellarApi.getEvents = jest.fn(() => {
      throw new Error('start is after newest ledger');
    });
    (stellarApi as any).fetchOperationsForLedger = jest.fn((seq: number) => [
      {type: {toString: () => 'invoke_host_function'}},
    ]);
    await expect((stellarApi as any).fetchAndWrapLedger(100)).rejects.toThrow(/(Gone|Not Found)/);
  });

  it('can extract all events from transactions', async () => {
    stellarApi = await prepareStellarApi('https://stellar.api.onfinality.io/public');
    const blockHeight = await stellarApi.getBestBlockHeight();
    const [block] = await stellarApi.fetchBlocks([blockHeight]);

    const events = await stellarApi.getEvents(blockHeight);

    expect(block.block.events.length).toEqual(events.length);
    for (let i = 0; i < events.length; i++) {
      expect(block.block.events[i].event).toEqual(events[i]);
    }
  });

  it('can extract transactions from ledger', async () => {
    stellarApi = await prepareStellarApi('https://stellar.api.onfinality.io/public');

    // TODO switch back to latest block, transactions get pruned so we cannot call getTransactionsFromLedger on older blocks
    const blockHeight = 60619894; //await stellarApi.getBestBlockHeight();
    const [block] = await stellarApi.fetchBlocks([blockHeight]);

    const txs = stellarApi.getTransactionsFromLedger(block.block.block);

    console.log('BLOCK HEIGHT', blockHeight);
    console.log('TXS length', txs.length);
    console.log('XXXXX', stellarApi.getChainId());
    expect(txs.length).toBeGreaterThan(0);
    expect(txs.length).toEqual(block.block.transactions.length);

    for (let i = 0; i < txs.length; i++) {
      console.log('TEST INDEX', i, block.block.transactions[i].tx.applicationOrder, txs[i].txHash);
      expect(txs[i].txHash).toEqual(block.block.transactions[i].tx.txHash);
      expect(txs[i].ledger).toEqual(block.block.transactions[i].tx.ledger);
      expect(txs[i].createdAt).toEqual(block.block.transactions[i].tx.createdAt);
      expect(txs[i].status).toEqual(block.block.transactions[i].tx.status);

      expect(txs[i].resultXdr.toXDR('base64')).toEqual(block.block.transactions[i].tx.resultXdr.toXDR('base64'));
      expect(txs[i].applicationOrder).toEqual(block.block.transactions[i].tx.applicationOrder);

      // Events
      expect(txs[i].diagnosticEventsXdr?.length).toEqual(block.block.transactions[i].tx.diagnosticEventsXdr?.length);
      expect(txs[i].events.transactionEventsXdr.length).toEqual(
        block.block.transactions[i].tx.events.transactionEventsXdr.length,
      );
      expect(txs[i].events.contractEventsXdr.length).toEqual(
        block.block.transactions[i].tx.events.contractEventsXdr.length,
      );

      expect(txs[i].envelopeXdr.toXDR('base64')).toEqual(block.block.transactions[i].tx.envelopeXdr.toXDR('base64'));
      expect(txs[i].feeBump).toEqual(block.block.transactions[i].tx.feeBump);

      // NOT WORKING
      // Seems to be non-deterministic, orders of arrays and data is different within these.
      if (txs[i].resultMetaXdr.toXDR('base64') !== block.block.transactions[i].tx.resultMetaXdr.toXDR('base64')) {
        console.log('MISSMATCH IN RESULT META XDR AT INDEX', i, txs[i].txHash, txs[i].resultMetaXdr.switch());

        // // Problem with tx 4 index 5
        // expect(
        //   txs[i].resultMetaXdr
        //     .v4()
        //     .diagnosticEvents()
        //     .map((evt) => evt.toXDR('base64')),
        // ).toEqual(
        //   block.block.transactions[i].tx.resultMetaXdr
        //     .v4()
        //     .diagnosticEvents()
        //     .map((evt) => evt.toXDR('base64')),
        // );

        // // Problem with tx 300, difference is buffer bs ChildUnion
        // // - Expected  - 8
        // //  + Received  + 5

        // //  - Object {
        // //  -   "data": Array [
        // //  -     0,
        // //  -     0,
        // //  -     0,
        // //  -     0,
        // //  -   ],
        // //  -   "type": "Buffer",
        // //  + ChildUnion {
        // //  +   "_arm": [Function Void],
        // //  +   "_armType": [Function Void],
        // //  +   "_switch": 0,
        // //  +   "_value": undefined,
        // //    }
        // expect(txs[i].resultMetaXdr.v4().ext()).toEqual(
        //   block.block.transactions[i].tx.resultMetaXdr.v4().ext().toXDR(),
        // );

        expect(
          txs[i].resultMetaXdr
            .v4()
            .operations()
            .map((evt) => evt.toXDR('base64')),
        ).toEqual(
          block.block.transactions[i].tx.resultMetaXdr
            .v4()
            .operations()
            .map((evt) => evt.toXDR('base64')),
        );
      }
      expect(txs[i].resultMetaXdr.toXDR('base64')).toEqual(
        block.block.transactions[i].tx.resultMetaXdr.toXDR('base64'),
      );
    }
  });

  it('can decode data', async () => {
    // stellarApi = await prepareStellarApi('https://stellar.api.onfinality.io/public');
    // const blockHeight = 60124580;
    // const [block] = await stellarApi.fetchBlocks([blockHeight]);

    // const events = await stellarApi.getEvents(60212419);

    // const txEvents = events.filter(
    //   (event) => (event.txHash = '8efd306b74c4b00629c88bc7d5cba75511c0197ce974ad67cbd78d7f918a4678'),
    // );

    // expect(txEvents.length).toBeGreaterThan(0);

    // const txEvents2 = txEvents.filter((evt) =>
    //   StellarBlockWrapped.filterEventProcessor({event: evt} as any, {topics: ['transfer']}),
    // );

    const xdrData = [
      '0000000f000000087472616e73666572',
      '00000012000000030000000035def769fcc519e3363f872e4fec9e5899133343f6c1a9ddc10c0e96c014c173',
      '00000012000000000000000037b41577e8bf238055f590f3acf364faf930dc1d9da6d8fd451a99fe194ef20b',
      '0000000e00000040524950504c45573a47414a505535454d4551423749354b574945484e46534d43514c564b524845344f433447555434505149554456454934474f484936464a4b',
    ];

    const parsedVals = xdrData.map((d) => xdr.ScVal.fromXDR(Buffer.from(d, 'hex')));

    // const nativeVals = parsedVals.map((v, idx) => {
    //   console.log(`XDR VALUE ${idx}`, v);
    //   return scValToNative(v);
    // });
    // console.log('PARSED VALUES', nativeVals);

    console.log('FROM VALUE', parsedVals[1].address().claimableBalanceId().value(), parsedVals[1]);
    console.log('XXXXX', scValToNative(parsedVals[1]));

    const xdrString = '00000012000000030000000035def769fcc519e3363f872e4fec9e5899133343f6c1a9ddc10c0e96c014c173';
    const parsed = xdr.ScVal.fromXDR(Buffer.from(xdrString, 'hex'));
    expect(scValToNative(parsed).toString('hex')).toBe('BA25553J7TCRTYZWH6DS4T7MTZMJSEZTIP3MDKO5YEGA5FWACTAXGHZL');

    // for (const evt of txEvents2) {
    //   const xdrValues = evt.topic.map((t) => t.toXDR().toString('hex'));
    //   try {
    //     evt.topic.map((t) => scValToNative(t));
    //   } catch (e) {
    //     console.log(`Failed to parse event`, xdrValues, e);
    //     throw e;
    //   }
    // }

    // console.log('TX EVENTS', txEvents.length, txEvents2.length);
  });

  // it('handles a transaction with multiple operations and events', async () => {
  //   const api = await prepareStellarApi('https://soroban-testnet.stellar.org');

  //   const [block] = await api.fetchBlocks([466592]);

  //   const tx = block.block.transactions.find(
  //     (tx) => tx.hash === '7967828275a8ba2442a0d4d21e8052b77ec87e8601598173e8857ad96c135685',
  //   );

  //   expect(tx).toBeDefined();

  //   expect(tx?.operations.length).toEqual(4);
  //   expect(tx?.events.length).toEqual(2);

  //   // Events should be correctly assigned to operations
  //   expect(tx?.operations[0].events.length).toEqual(1);
  //   expect(tx?.operations[1].events.length).toEqual(1);
  //   expect(tx?.operations[2].events.length).toEqual(0);
  //   expect(tx?.operations[3].events.length).toEqual(0);
  // });
});
