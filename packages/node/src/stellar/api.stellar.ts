// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import assert from 'assert';
import {Horizon, rpc} from '@stellar/stellar-sdk';
import {getLogger, IBlock} from '@subql/node-core';
import {
  SorobanEvent,
  StellarBlock,
  StellarBlockWrapper,
  StellarEffect,
  StellarOperation,
  StellarTransaction,
  IStellarEndpointConfig,
} from '@subql/types-stellar';
import {cloneDeep} from 'lodash';
import {StellarBlockWrapped} from '../stellar/block.stellar';
import SafeStellarProvider from './safe-api';
import {SorobanServer} from './soroban.server';
import {DEFAULT_PAGE_SIZE, formatBlockUtil} from './utils.stellar';

const logger = getLogger('api.Stellar');

export class StellarApi {
  private stellarClient: Horizon.Server;

  private chainId?: string;
  private pageLimit = DEFAULT_PAGE_SIZE;

  constructor(private endpoint: string, private _sorobanClient?: SorobanServer, config?: IStellarEndpointConfig) {
    const {hostname, protocol} = new URL(this.endpoint);
    this.pageLimit = config?.pageLimit || this.pageLimit;

    const protocolStr = protocol.replace(':', '');

    logger.info(`Api host: ${hostname}, method: ${protocolStr}, pageLimit: ${this.pageLimit}`);
    if (protocolStr === 'https' || protocolStr === 'http') {
      const options: Horizon.Server.Options = {
        allowHttp: protocolStr === 'http',
        headers: {
          ...config?.headers,
        },
      };

      this.stellarClient = new Horizon.Server(endpoint, options);
    } else {
      throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  async init(): Promise<void> {
    const {passphrase} = await this._sorobanClient!.getNetwork();
    this.chainId = passphrase;
    //need archive node for genesis hash
  }

  get sorobanClient(): SorobanServer {
    assert(this._sorobanClient, 'Soraban client is not initialized');
    return this._sorobanClient;
  }

  async getFinalizedBlock(): Promise<Horizon.ServerApi.LedgerRecord> {
    const latest = this._sorobanClient!.getLatestLedger();
    // TODO get the latest ledger to provide sufficient information such as timestamp
    throw new Error('Not updated');
    // return (await this.stellarClient.ledgers().order('desc').call()).records[0];
  }

  async getFinalizedBlockHeight(): Promise<number> {
    const {sequence} = await this._sorobanClient!.getLatestLedger();
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
    const rpcTxs: rpc.Api.TransactionInfo[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.sorobanClient.getTransactions({
        startLedger: ledger,
        limit: this.pageLimit,
        cursor,
      });
      cursor = page.cursor;
      const ledgerTxs = page.transactions.filter((tx) => tx.ledger === ledger);
      if (!ledgerTxs.length) {
        break;
      }
      rpcTxs.push(...ledgerTxs);
    }

    const tx = rpcTxs[0];

    const operation = tx.envelopeXdr.v0().tx().operations()[0];

    return rpcTxs;
  }

  private async fetchEventsForLedger(ledger: number): Promise<rpc.Api.EventResponse[]> {
    const rpcEvents: rpc.Api.EventResponse[] = [];

    let cursor: string | undefined;
    for (;;) {
      const page = await this.sorobanClient.getEvents(
        cursor
          ? {
              filters: [],
              cursor,
            }
          : {
              startLedger: ledger,
              endLedger: ledger,
              limit: this.pageLimit,
              filters: [],
            },
      );
      cursor = page.cursor;
      const ledgerEvents = page.events.filter((event) => event.ledger === ledger);
      if (!ledgerEvents.length) {
        break;
      }
      rpcEvents.push(...ledgerEvents);
    }
    return rpcEvents;
  }

  // private async fetchOperationsForLedger(sequence: number): Promise<Horizon.ServerApi.OperationRecord[]> {
  //   const operations: Horizon.ServerApi.OperationRecord[] = [];
  //   let operationsPage = await this.api.operations().forLedger(sequence).limit(this.pageLimit).call();
  //   while (operationsPage.records.length !== 0) {
  //     operations.push(...operationsPage.records);
  //     operationsPage = await operationsPage.next();
  //   }

  //   return operations;
  // }

  // private async fetchEffectsForLedger(sequence: number): Promise<Horizon.ServerApi.EffectRecord[]> {
  //   const effects: Horizon.ServerApi.EffectRecord[] = [];

  //   let effectsPage = await this.api.effects().forLedger(sequence).limit(this.pageLimit).call();
  //   while (effectsPage.records.length !== 0) {
  //     effects.push(...effectsPage.records);
  //     effectsPage = await effectsPage.next();
  //   }

  //   return effects;
  // }

  async getAndWrapEvents(height: number): Promise<SorobanEvent[]> {
    const {events: events} = await this.sorobanClient.getEvents({
      startLedger: height,
      filters: [],
      limit: this.pageLimit,
    });
    return events.map((event) => {
      const wrappedEvent = {
        ...event,
        ledger: null,
        transaction: null,
        operation: null,
      } as SorobanEvent;

      return wrappedEvent;
    });
  }

  private wrapEffect(effect: Horizon.ServerApi.EffectRecord): StellarEffect {
    return {
      ...effect,
      ledger: null,
      transaction: null,
      operation: null,
    };
  }

  private wrapOperationsForTx(
    operations: Horizon.ServerApi.OperationRecord[],
    effectsForSequence: Record<string, Horizon.ServerApi.EffectRecord[]>,
    events: SorobanEvent[],
  ): StellarOperation[] {
    // If there are soroban events then there should only be a single operation.
    // This check is here in case there are furture changes to the network.
    assert(events.length > 0 ? operations.length === 1 : true, 'Unable to assign events to multiple operations');

    return operations.map((op, index) => {
      const effects = (effectsForSequence[op.id] ?? []).map(this.wrapEffect.bind(this));
      // const effects = this.wrapEffectsForOperation(index, effectsForSequence);

      const wrappedOp: StellarOperation = {
        ...op,
        ledger: null,
        transaction: null,
        effects: [],
        events,
      };

      const clonedOp = cloneDeep(wrappedOp);

      effects.forEach((effect) => {
        effect.operation = clonedOp;
        wrappedOp.effects.push(effect);
      });

      return wrappedOp;
    });
  }

  private wrapTransactionsForLedger(
    transactions: Horizon.ServerApi.TransactionRecord[],
    operationsForSequence: Horizon.ServerApi.OperationRecord[],
    effectsForSequence: Horizon.ServerApi.EffectRecord[],
    eventsForSequence: SorobanEvent[],
  ): StellarTransaction[] {
    return transactions.map((tx) => {
      const wrappedTx: StellarTransaction = {
        ...tx,
        ledger: null,
        operations: [] as StellarOperation[],
        effects: [] as StellarEffect[],
        events: [] as SorobanEvent[],
      };

      // Effects grouped by the operation id
      const groupedEffects = effectsForSequence.reduce((acc, item) => {
        // BigInt conversion is for stripping leading 0s
        const key = BigInt(item.id.split('-')[0]).toString();
        acc[key] ??= [];
        acc[key].push(item);

        return acc;
      }, {} as Record<string, Horizon.ServerApi.EffectRecord[]>);

      // Operations grouped by the transaction hash
      const groupedOperations = operationsForSequence.reduce((acc, item) => {
        acc[item.transaction_hash] ??= [];
        acc[item.transaction_hash].push(item);

        return acc;
      }, {} as Record<string, Horizon.ServerApi.OperationRecord[]>);

      // Events grouped by the transaction hash
      const groupedEvents = eventsForSequence.reduce((acc, item) => {
        acc[item.txHash] ??= [];
        acc[item.txHash].push(item);

        return acc;
      }, {} as Record<string, SorobanEvent[]>);

      const clonedTx = cloneDeep(wrappedTx);
      const operations = this.wrapOperationsForTx(
        // TODO, this include other attribute from HorizonApi.TransactionResponse, but type assertion incorrect
        // TransactionRecord extends Omit<HorizonApi.TransactionResponse, "created_at">
        groupedOperations[tx.hash] ?? [],
        groupedEffects,
        groupedEvents[tx.hash] ?? [],
      ).map((op) => {
        op.transaction = clonedTx;
        op.effects = op.effects.map((effect) => {
          effect.transaction = clonedTx;
          return effect;
        });
        op.events = op.events.map((event) => {
          event.transaction = clonedTx;
          return event;
        });
        return op;
      });

      wrappedTx.operations.push(...operations);
      operations.forEach((op) => {
        wrappedTx.effects.push(...op.effects);
        wrappedTx.events.push(...op.events);
      });

      return wrappedTx;
    });
  }

  private async fetchAndWrapLedger(sequence: number): Promise<IBlock<StellarBlockWrapper>> {
    const [ledger, transactions, operations, effects] = await Promise.all([
      this.api.ledgers().ledger(sequence).call(),
      this.fetchTransactionsForLedger(sequence),
      this.fetchOperationsForLedger(sequence),
      this.fetchEffectsForLedger(sequence),
    ]);

    let eventsForSequence: SorobanEvent[] = [];

    //check if there is InvokeHostFunctionOp operation
    //If yes then, there are soroban transactions and we should we fetch soroban events
    const hasInvokeHostFunctionOp = operations.some((op) => op.type.toString() === 'invoke_host_function');

    if (this.sorobanClient && hasInvokeHostFunctionOp) {
      try {
        eventsForSequence = await this.getAndWrapEvents(sequence);
      } catch (e: any) {
        if (e.message === 'start is after newest ledger') {
          const latestLedger = (await this.sorobanClient.getLatestLedger()).sequence;
          throw new Error(`The requested events for ledger number ${sequence} is not available on the current soroban node.
                This is because you're trying to access a ledger that is after the latest ledger number ${latestLedger} stored in this node.
                To resolve this issue, please check you endpoint node start height`);
        }

        if (e.message === 'start is before oldest ledger') {
          throw new Error(`The requested events for ledger number ${sequence} is not available on the current soroban node.
                This is because you're trying to access a ledger that is older than the oldest ledger stored in this node.
                To resolve this issue, you can either:
                1. Increase the start ledger to a more recent one, or
                2. Connect to a different node that might have a longer history of ledgers.`);
        }

        throw e;
      }
    }

    const wrappedLedger: StellarBlock = {
      ...(ledger as unknown as Horizon.ServerApi.LedgerRecord),
      transactions: [] as StellarTransaction[],
      operations: [] as StellarOperation[],
      effects: [] as StellarEffect[],
      events: eventsForSequence,
    };

    const wrapperTxs = this.wrapTransactionsForLedger(transactions, operations, effects, eventsForSequence);

    const clonedLedger = cloneDeep(wrappedLedger);

    wrapperTxs.forEach((tx) => {
      tx.ledger = clonedLedger;
      tx.operations = tx.operations.map((op) => {
        op.ledger = clonedLedger;
        op.effects = op.effects.map((effect) => {
          effect.ledger = clonedLedger;
          return effect;
        });
        op.events = op.events.map((event) => {
          event.ledger = clonedLedger;
          return event;
        });
        return op;
      });

      wrappedLedger.transactions.push(tx);
      wrappedLedger.operations.push(...tx.operations);

      tx.operations.forEach((op) => {
        wrappedLedger.effects.push(...op.effects);
      });
    });

    const wrappedLedgerInstance = new StellarBlockWrapped(
      wrappedLedger,
      wrappedLedger.transactions,
      wrappedLedger.operations,
      wrappedLedger.effects,
      wrappedLedger.events,
    );

    return formatBlockUtil(wrappedLedgerInstance);
  }

  async fetchBlocks(bufferBlocks: number[]): Promise<IBlock<StellarBlockWrapper>[]> {
    const ledgers = await Promise.all(bufferBlocks.map((sequence) => this.fetchAndWrapLedger(sequence)));
    return ledgers;
  }

  get api(): Horizon.Server {
    return this.stellarClient;
  }

  getSafeApi(blockHeight: number): SafeStellarProvider {
    //safe api not implemented yet
    return new SafeStellarProvider(this.sorobanClient, blockHeight);
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
