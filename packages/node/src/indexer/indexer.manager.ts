// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {Inject, Injectable} from '@nestjs/common';
import {rpc} from '@stellar/stellar-sdk';
import {
  isCustomDs,
  isRuntimeDs,
  SubqlStellarCustomDataSource,
  StellarHandlerKind,
  StellarRuntimeHandlerInputMap,
  SubqlStellarDataSource,
  isBlockHandlerProcessor,
  isTransactionHandlerProcessor,
  isOperationHandlerProcessor,
  isEventHandlerProcessor,
} from '@subql/common-stellar';
import {
  NodeConfig,
  getLogger,
  profiler,
  IndexerSandbox,
  ProcessBlockResponse,
  BaseIndexerManager,
  IBlock,
  SandboxService,
  DsProcessorService,
  DynamicDsService,
  UnfinalizedBlocksService,
} from '@subql/node-core';
import {
  StellarBlockWrapper,
  SubqlDatasource,
  StellarBlockFilter,
  StellarTransactionFilter,
  StellarOperationFilter,
  StellarEventFilter,
  StellarEvent,
  StellarOperation,
  StellarTransaction,
  StellarBlock,
} from '@subql/types-stellar';
import {BlockchainService} from '../blockchain.service';
import {StellarApi, StellarApiService} from '../stellar';
import {StellarBlockWrapped} from '../stellar/block.stellar';
import SafeStellarProvider from '../stellar/safe-api';

const logger = getLogger('indexer');

@Injectable()
export class IndexerManager extends BaseIndexerManager<
  StellarApi,
  SafeStellarProvider | null,
  StellarBlockWrapper,
  StellarApiService,
  SubqlStellarDataSource,
  SubqlStellarCustomDataSource,
  typeof FilterTypeMap,
  typeof ProcessorTypeMap,
  StellarRuntimeHandlerInputMap
> {
  protected isRuntimeDs = isRuntimeDs;
  protected isCustomDs = isCustomDs;

  constructor(
    @Inject('APIService') apiService: StellarApiService,
    nodeConfig: NodeConfig,
    sandboxService: SandboxService<SafeStellarProvider | null, StellarApi>,
    dsProcessorService: DsProcessorService,
    dynamicDsService: DynamicDsService<SubqlStellarDataSource>,
    @Inject('IUnfinalizedBlocksService')
    unfinalizedBlocksService: UnfinalizedBlocksService,
    @Inject('IBlockchainService') blockchainService: BlockchainService,
  ) {
    super(
      apiService,
      nodeConfig,
      sandboxService,
      dsProcessorService,
      dynamicDsService,
      unfinalizedBlocksService,
      FilterTypeMap,
      ProcessorTypeMap,
      blockchainService,
    );
  }

  @profiler()
  async indexBlock(
    block: IBlock<StellarBlockWrapper>,
    dataSources: SubqlStellarDataSource[],
  ): Promise<ProcessBlockResponse> {
    return super.internalIndexBlock(block, dataSources, () => this.getApi(block.block));
  }

  protected getDsProcessor(ds: SubqlStellarDataSource, safeApi: SafeStellarProvider): IndexerSandbox {
    // Expand on the type here to allow for extra injections, we also change the unsafeApi type
    const sandbox = this.sandboxService as unknown as SandboxService<SafeStellarProvider | null, rpc.Server>;
    return sandbox.getDsProcessor(ds, safeApi, this.apiService.unsafeApi.rpcClient);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async getApi(block: StellarBlockWrapper): Promise<SafeStellarProvider | null> {
    // return this.apiService.safeApi(block.block.sequence);
    return null;
  }

  protected async indexBlockData(
    {block, transactions}: StellarBlockWrapper,
    dataSources: SubqlDatasource[],
    getVM: (d: SubqlDatasource) => Promise<IndexerSandbox>,
  ): Promise<void> {
    await this.indexBlockContent(block, dataSources, getVM);

    const groupedOperations = block.operations.reduce((acc, op) => {
      acc[op.transaction.tx.txHash] ??= [];
      acc[op.transaction.tx.txHash].push(op);

      return acc;
    }, {} as Record<string, StellarOperation[]>);

    const groupedEvents = block.events.reduce((acc, evt) => {
      acc[evt.event.txHash] ??= [];
      acc[evt.event.txHash].push(evt);

      return acc;
    }, {} as Record<string, StellarEvent[]>);

    for (const tx of transactions) {
      await this.indexTransaction(tx, dataSources, getVM);

      const operationEvents = (groupedEvents[tx.tx.txHash] ?? []).reduce((acc, evt) => {
        acc[evt.event.operationIndex] ??= [];
        acc[evt.event.operationIndex].push(evt);

        return acc;
      }, {} as Record<string, StellarEvent[]>);

      for (const [index, operation] of Object.entries(groupedOperations[tx.tx.txHash])) {
        await this.indexOperation(operation, dataSources, getVM);

        const events = operationEvents[index] ?? [];
        for (const event of events) {
          await this.indexEvent(event, dataSources, getVM);
        }
      }
    }
  }

  private async indexBlockContent(
    block: StellarBlock,
    dataSources: SubqlDatasource[],
    getVM: (d: SubqlDatasource) => Promise<IndexerSandbox>,
  ): Promise<void> {
    for (const ds of dataSources) {
      await this.indexData(StellarHandlerKind.Block, block, ds, getVM);
    }
  }

  private async indexTransaction(
    transaction: StellarTransaction,
    dataSources: SubqlDatasource[],
    getVM: (d: SubqlDatasource) => Promise<IndexerSandbox>,
  ): Promise<void> {
    for (const ds of dataSources) {
      await this.indexData(StellarHandlerKind.Transaction, transaction, ds, getVM);
    }
  }

  private async indexOperation(
    operation: StellarOperation,
    dataSources: SubqlDatasource[],
    getVM: (d: SubqlDatasource) => Promise<IndexerSandbox>,
  ): Promise<void> {
    for (const ds of dataSources) {
      await this.indexData(StellarHandlerKind.Operation, operation, ds, getVM);
    }
  }

  private async indexEvent(
    event: StellarEvent,
    dataSources: SubqlDatasource[],
    getVM: (d: SubqlDatasource) => Promise<IndexerSandbox>,
  ): Promise<void> {
    for (const ds of dataSources) {
      await this.indexData(StellarHandlerKind.Event, event, ds, getVM);
    }
  }

  protected async prepareFilteredData<T = any>(kind: StellarHandlerKind, data: T, ds: SubqlDatasource): Promise<T> {
    return Promise.resolve(data);
  }
}

type ProcessorTypeMap = {
  [StellarHandlerKind.Block]: typeof isBlockHandlerProcessor;
  [StellarHandlerKind.Transaction]: typeof isTransactionHandlerProcessor;
  [StellarHandlerKind.Operation]: typeof isOperationHandlerProcessor;
  [StellarHandlerKind.Event]: typeof isEventHandlerProcessor;
};

const ProcessorTypeMap = {
  [StellarHandlerKind.Block]: isBlockHandlerProcessor,
  [StellarHandlerKind.Transaction]: isTransactionHandlerProcessor,
  [StellarHandlerKind.Operation]: isOperationHandlerProcessor,
  [StellarHandlerKind.Event]: isEventHandlerProcessor,
};

const FilterTypeMap = {
  [StellarHandlerKind.Block]: (data: StellarBlock, filter: StellarBlockFilter, ds: SubqlStellarDataSource) =>
    StellarBlockWrapped.filterBlocksProcessor(data, filter),
  [StellarHandlerKind.Transaction]: (
    data: StellarTransaction,
    filter: StellarTransactionFilter,
    ds: SubqlStellarDataSource,
  ) => StellarBlockWrapped.filterTransactionProcessor(data, filter, ds.options?.address),
  [StellarHandlerKind.Operation]: (
    data: StellarOperation,
    filter: StellarOperationFilter,
    ds: SubqlStellarDataSource,
  ) => StellarBlockWrapped.filterOperationProcessor(data, filter),
  [StellarHandlerKind.Event]: (data: StellarEvent, filter: StellarEventFilter, ds: SubqlStellarDataSource) =>
    StellarBlockWrapped.filterEventProcessor(data, filter, ds.options?.address),
};
