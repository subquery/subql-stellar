// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import assert from 'assert';
import {rpc, xdr} from '@stellar/stellar-sdk';
import {getLogger, IBlock} from '@subql/node-core';
import {
  StellarBlockWrapper,
  IStellarEndpointConfig,
  StellarBlock,
  StellarTransaction,
  StellarOperation,
  StellarEvent,
} from '@subql/types-stellar';
import {StellarBlockWrapped} from '../stellar/block.stellar';
import SafeStellarProvider from './safe-api';
import {
  calculateTxHash,
  constructTransaction,
  contractEventToEventResponse,
  DEFAULT_PAGE_SIZE,
  formatBlockUtil,
  getBlockTimestamp,
} from './utils.stellar';

const logger = getLogger('api.Stellar');

export class StellarApi {
  private chainId?: string;
  private pageLimit = DEFAULT_PAGE_SIZE;
  readonly rpcClient: rpc.Server;

  constructor(endpoint: string, config?: IStellarEndpointConfig) {
    this.pageLimit = config?.pageLimit || this.pageLimit;

    const {protocol} = new URL(endpoint);
    this.rpcClient = new rpc.Server(endpoint, {
      allowHttp: protocol === 'http:',
    });
  }

  async init(): Promise<void> {
    const {passphrase} = await this.rpcClient.getNetwork();
    this.chainId = passphrase;
    //need archive node for genesis hash
  }

  async getFinalizedBlock(): Promise<rpc.Api.LedgerResponse> {
    const latest = await this.rpcClient.getLatestLedger();

    return this.getLedgerForSequence(latest.sequence);
  }

  private async getLedgerForSequence(sequence: number): Promise<rpc.Api.LedgerResponse> {
    const {ledgers} = await this.rpcClient.getLedgers({
      startLedger: sequence,
      pagination: {
        limit: 1,
      },
    });

    if (!ledgers.length) {
      throw new Error(`Failed to get finalized block: ${sequence}`);
    }

    return ledgers[0];
  }

  async getFinalizedBlockHeight(): Promise<number> {
    const {sequence} = await this.rpcClient.getLatestLedger();
    return sequence;
  }

  async getBestBlockHeight(): Promise<number> {
    // Cannot find any documentation about block finality
    return this.getFinalizedBlockHeight();
  }

  getRuntimeChain(): string {
    assert(this.chainId, 'Api has not been initialised');
    return this.chainId;
  }

  getChainId(): string {
    assert(this.chainId, 'Api has not been initialised');
    return this.chainId;
  }

  getGenesisHash(): string {
    assert(this.chainId, 'Api has not been initialised');
    return this.chainId;
  }

  getSpecName(): string {
    return 'Stellar';
  }

  private async fetchTransactionsForLedger(ledger: number): Promise<rpc.Api.TransactionInfo[]> {
    try {
      const rpcTxs: rpc.Api.TransactionInfo[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await this.rpcClient.getTransactions(
          cursor
            ? {
                pagination: {
                  limit: this.pageLimit,
                  cursor,
                },
              }
            : {
                startLedger: ledger,
                pagination: {
                  limit: this.pageLimit,
                },
              },
        );
        cursor = page.cursor;
        const ledgerTxs = page.transactions.filter((tx) => tx.ledger === ledger);
        if (!ledgerTxs.length) {
          break;
        }
        rpcTxs.push(...ledgerTxs);
      }

      return rpcTxs;
    } catch (e: any) {
      // The error throw here generally is not an instance of Error, so we need to convert it for better logging
      if (!(e instanceof Error) && e.message) {
        const error = new Error(e.message);
        (error as any).code = e.code;
        throw error;
      }
      throw e;
    }
  }

  async getEvents(height: number): Promise<rpc.Api.EventResponse[]> {
    const rpcEvents: rpc.Api.EventResponse[] = [];
    let cursor: string | undefined;

    for (;;) {
      const res = await this.rpcClient.getEvents(
        cursor
          ? {
              cursor,
              filters: [],
              limit: this.pageLimit,
            }
          : {
              startLedger: height, // Inclusive
              endLedger: height + 1, // Exclusive, setting to height gives no results
              filters: [],
              limit: this.pageLimit,
            },
      );

      cursor = res.cursor;
      rpcEvents.push(...res.events.filter((event) => event.ledger === height));

      // The last page contains events from the next ledger, so we need to stop if we see that
      if (!res.events.length || res.events[res.events.length - 1].ledger > height) {
        break;
      }
    }

    return rpcEvents;
  }

  /**
   * Converts the events data from transaction info into the same response as getEvents
   **/
  private extractEventsFromTransactions(txs: rpc.Api.TransactionInfo[], timestamp: Date): rpc.Api.EventResponse[] {
    const beforeAllTxEvents: rpc.Api.EventResponse[] = [];
    const allContractEvents: rpc.Api.EventResponse[] = []; // Including AfterTx transactionEvents
    const afterAllTxEvents: rpc.Api.EventResponse[] = [];
    let count = 0;
    let afterCount = 0;
    for (const tx of txs) {
      tx.events.transactionEventsXdr.forEach((evt) => {
        switch (evt.stage()) {
          case xdr.TransactionEventStage.transactionEventStageBeforeAllTxes():
            beforeAllTxEvents.push(contractEventToEventResponse(evt.event(), tx, 0, 0, count++, timestamp));
            break;
          case xdr.TransactionEventStage.transactionEventStageAfterAllTxes():
            afterAllTxEvents.push(
              contractEventToEventResponse(
                evt.event(),
                tx,
                1048575, //tx.tx.applicationOrder - 1,
                0,
                afterCount++,
                timestamp,
              ),
            );
            break;
          case xdr.TransactionEventStage.transactionEventStageAfterTx():
            allContractEvents.push(
              contractEventToEventResponse(evt.event(), tx, tx.applicationOrder - 1, 0, count++, timestamp),
            );
            break;
          default:
            throw new Error(`Unknown transaction event stage: ${evt.stage().name}`);
        }
      });
      const eventsFromContracts = [
        ...tx.events.contractEventsXdr.flatMap((evts, opIdx) =>
          evts.map((evt, eventIdx) =>
            contractEventToEventResponse(evt, tx, tx.applicationOrder, opIdx, eventIdx, timestamp),
          ),
        ),
      ];
      allContractEvents.push(...eventsFromContracts);
    }
    // Combine all the events in the correct order
    const allBlockEvents = [...beforeAllTxEvents, ...allContractEvents, ...afterAllTxEvents];

    return allBlockEvents;
  }

  private parseLedgerV0Meta(ledger: rpc.Api.LedgerResponse, meta: xdr.LedgerCloseMetaV0): rpc.Api.TransactionInfo[] {
    // Not tested on a block that is v0
    return meta
      .txSet()
      .txes()
      .map((tx, idx) => {
        return constructTransaction(ledger, meta, tx, idx);
      });
  }

  private parseLedgerV1V2Meta(
    ledger: rpc.Api.LedgerResponse,
    meta: xdr.LedgerCloseMetaV2 | xdr.LedgerCloseMetaV1,
  ): rpc.Api.TransactionInfo[] {
    const ver = meta.txSet().switch();
    if (ver !== 1) {
      throw new Error('Unsupported tx set version');
    }

    // Extract all the envelopes and index by hash, this is really slow calculating the hash for each tx,
    // but it is needed to get the order right to match with the txProcessing info.
    const envelopes: Record<string, xdr.TransactionEnvelope> = meta
      .txSet()
      .v1TxSet()
      .phases()
      .flatMap((phase) => {
        switch (phase.switch()) {
          case 0: {
            return phase.v0Components().flatMap((comp) => {
              if (comp.switch() !== xdr.TxSetComponentType.txsetCompTxsMaybeDiscountedFee()) {
                throw new Error(`Unhandled component type: ${comp.switch().name}`);
              }

              return comp.txsMaybeDiscountedFee().txes();
            });
          }
          case 1: {
            return phase
              .parallelTxsComponent()
              .executionStages()
              .flatMap((stage) => {
                return stage.flatMap((envelopes) => envelopes);
              });
          }
          default: {
            throw new Error(`Unsupported phase type: ${phase.switch()}`);
          }
        }
      })
      .reduce((acc, value) => {
        const hash = calculateTxHash(value, this.getChainId());
        acc[hash] = value;
        return acc;
      }, {});

    return meta.txProcessing().map((txp, index) => {
      const txHash = txp.result().transactionHash().toString('hex');
      const txEnvelope = envelopes[txHash];
      if (!txEnvelope) {
        throw new Error(`Unable to find envelope for hash: ${txHash}`);
      }
      return constructTransaction(ledger, meta, txEnvelope, index);
    });

    let idx = 0;
    // Itterate over the transactions, but they are not in the application order.
    // TODO awaiting clarification in Stellar TG chat
    return meta
      .txSet()
      .v1TxSet()
      .phases()
      .flatMap((phase) => {
        switch (phase.switch()) {
          case 0: {
            return phase.v0Components().flatMap((comp) => {
              if (comp.switch() !== xdr.TxSetComponentType.txsetCompTxsMaybeDiscountedFee()) {
                throw new Error(`Unhandled component type: ${comp.switch().name}`);
              }

              return comp
                .txsMaybeDiscountedFee()
                .txes()
                .map((txEnvelope) => {
                  idx++;
                  return constructTransaction(ledger, meta, txEnvelope, idx - 1);
                });
            });
          }
          case 1: {
            return phase
              .parallelTxsComponent()
              .executionStages()
              .flatMap((stage) => {
                return stage.flatMap((envelopes) => {
                  return envelopes.map((txEnvelope) => {
                    idx++;
                    return constructTransaction(ledger, meta, txEnvelope, idx - 1);
                  });
                });
              });
          }
          default: {
            throw new Error(`Unsupported phase type: ${phase.switch()}`);
          }
        }
      });
  }

  getTransactionsFromLedger(ledger: rpc.Api.LedgerResponse): rpc.Api.TransactionInfo[] {
    switch (ledger.metadataXdr.switch()) {
      case 0:
        // NOTE: this is untested
        return this.parseLedgerV0Meta(ledger, ledger.metadataXdr.v0());
      case 1:
      case 2:
        return this.parseLedgerV1V2Meta(ledger, ledger.metadataXdr.v2());
      default: {
        throw new Error(`Unsupported ledger version: ${ledger.metadataXdr.switch()}`);
      }
    }
  }

  private async fetchAndWrapLedger(sequence: number): Promise<IBlock<StellarBlockWrapper>> {
    // TODO stop using fetchTransactionsForLedger and instead use getTransactionsFromLedger, this requires more work.
    const [ledger, transactions] = await Promise.all([
      this.getLedgerForSequence(sequence),
      this.fetchTransactionsForLedger(sequence),
      // this.getEvents(sequence),
    ]);

    const events = this.extractEventsFromTransactions(transactions, getBlockTimestamp(ledger));

    const wrappedLedger: StellarBlock = {
      ...ledger,
      transactions: [],
      operations: [],
      events: [],
    };

    wrappedLedger.transactions = transactions.map((tx, index) => {
      return {
        tx,
        events: events.filter((event) => event.transactionIndex === index),
      } satisfies StellarTransaction;
    });

    wrappedLedger.operations = transactions.flatMap((tx, txIndex) => {
      const extractOperations = (tx: rpc.Api.TransactionInfo): xdr.Operation[] => {
        switch (tx.envelopeXdr.switch()) {
          case xdr.EnvelopeType.envelopeTypeTxV0(): {
            return tx.envelopeXdr.v0().tx().operations();
          }
          case xdr.EnvelopeType.envelopeTypeTx(): {
            return tx.envelopeXdr.v1().tx().operations();
          }
          case xdr.EnvelopeType.envelopeTypeTxFeeBump(): {
            return tx.envelopeXdr.feeBump().tx().innerTx().v1().tx().operations();
          }
          default: {
            logger.warn(
              `Unable to extract operations for transaction ${tx.txHash} with type ${tx.envelopeXdr.switch().name}`,
            );
            return [];
          }
        }
      };
      return extractOperations(tx).map((op, index) => {
        return {
          index,
          // TODO feeBump transactions can have an inner transaction, should this be set here instead?
          transaction: wrappedLedger.transactions[txIndex],
          operation: op,
        } satisfies StellarOperation;
      });
    });

    wrappedLedger.events = events.map((event) => {
      const tx = transactions.find((tx) => tx.txHash === event.txHash);
      if (!tx) {
        throw new Error(`Unable to find matching transaction for squence ${sequence}, index ${event.transactionIndex}`);
      }

      return {
        event,
        block: wrappedLedger,
        tx,
      } satisfies StellarEvent;
    });

    const wrappedLedgerInstance = new StellarBlockWrapped(
      wrappedLedger,
      wrappedLedger.transactions,
      wrappedLedger.operations,
      wrappedLedger.events,
    );

    return formatBlockUtil(wrappedLedgerInstance);
  }

  async fetchBlocks(bufferBlocks: number[]): Promise<IBlock<StellarBlockWrapper>[]> {
    return Promise.all(bufferBlocks.map((sequence) => this.fetchAndWrapLedger(sequence)));
  }

  getSafeApi(blockHeight: number): SafeStellarProvider {
    return new SafeStellarProvider(this.rpcClient, blockHeight);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async connect(): Promise<void> {
    logger.error('Stellar API connect is not implemented');
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async disconnect(): Promise<void> {
    logger.error('Stellar API disconnect is not implemented');
    throw new Error('Not implemented');
  }

  handleError(e: Error, height: number): Error {
    if (e.message === 'start is before oldest ledger') {
      return new Error(`The requested ledger number ${height} is not available on the current blockchain node.
      This is because you're trying to access a ledger that is older than the oldest ledger stored in this node.
      To resolve this issue, you can either:
      1. Increase the start ledger to a more recent one, or
      2. Connect to a different node that might have a longer history of ledgers.`);
    }

    return e;
  }
}
