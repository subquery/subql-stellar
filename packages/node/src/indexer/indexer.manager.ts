// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { Inject, Injectable } from '@nestjs/common';
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
  isEffectHandlerProcessor,
  isEventHandlerProcessor,
  isSorobanTransactionHandlerProcessor,
} from '@subql/common-stellar';
import {
  NodeConfig,
  getLogger,
  profiler,
  IndexerSandbox,
  ProcessBlockResponse,
  BaseIndexerManager,
  ApiService,
  IBlock,
  SandboxService,
  DsProcessorService,
  DynamicDsService,
  UnfinalizedBlocksService,
  ProjectService,
} from '@subql/node-core';
import {
  StellarBlockWrapper,
  SubqlDatasource,
  StellarTransaction,
  StellarOperation,
  StellarEffect,
  StellarBlock,
  StellarBlockFilter,
  StellarTransactionFilter,
  StellarOperationFilter,
  StellarEffectFilter,
  SorobanEvent,
  SorobanEventFilter,
} from '@subql/types-stellar';
import { BlockchainService } from '../blockchain.service';
import { StellarApi } from '../stellar';
import { StellarBlockWrapped } from '../stellar/block.stellar';
import SafeStellarProvider from '../stellar/safe-api';

const logger = getLogger('indexer');

@Injectable()
export class IndexerManager extends BaseIndexerManager<
  StellarApi,
  SafeStellarProvider | null,
  StellarBlockWrapper,
  ApiService,
  SubqlStellarDataSource,
  SubqlStellarCustomDataSource,
  typeof FilterTypeMap,
  typeof ProcessorTypeMap,
  StellarRuntimeHandlerInputMap
> {
  protected isRuntimeDs = isRuntimeDs;
  protected isCustomDs = isCustomDs;

  constructor(
    @Inject('APIService') apiService: ApiService,
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
    return super.internalIndexBlock(block, dataSources, () =>
      this.getApi(block.block),
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async getApi(
    block: StellarBlockWrapper,
  ): Promise<SafeStellarProvider | null> {
    // return this.apiService.safeApi(block.block.sequence);
    return null;
  }

  protected async indexBlockData(
    { block, transactions }: StellarBlockWrapper,
    dataSources: SubqlDatasource[],
    getVM: (d: SubqlDatasource) => Promise<IndexerSandbox>,
  ): Promise<void> {
    await this.indexBlockContent(block, dataSources, getVM);

    for (const tx of transactions) {
      await this.indexTransaction(tx, dataSources, getVM);

      for (const operation of tx.operations) {
        await this.indexOperation(operation, dataSources, getVM);

        for (const effect of operation.effects) {
          await this.indexEffect(effect, dataSources, getVM);
        }
        for (const event of operation.events) {
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
      await this.indexData(
        StellarHandlerKind.Transaction,
        transaction,
        ds,
        getVM,
      );

      if (
        transaction.operations.some(
          (op) => op.type.toString() === 'invoke_host_function',
        )
      ) {
        await this.indexData(
          StellarHandlerKind.SorobanTransaction,
          transaction,
          ds,
          getVM,
        );
      }
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

  private async indexEffect(
    effect: StellarEffect,
    dataSources: SubqlDatasource[],
    getVM: (d: SubqlDatasource) => Promise<IndexerSandbox>,
  ): Promise<void> {
    for (const ds of dataSources) {
      await this.indexData(StellarHandlerKind.Effects, effect, ds, getVM);
    }
  }

  private async indexEvent(
    event: SorobanEvent,
    dataSources: SubqlDatasource[],
    getVM: (d: SubqlDatasource) => Promise<IndexerSandbox>,
  ): Promise<void> {
    for (const ds of dataSources) {
      await this.indexData(StellarHandlerKind.Event, event, ds, getVM);
    }
  }

  protected async prepareFilteredData<T = any>(
    kind: StellarHandlerKind,
    data: T,
    ds: SubqlDatasource,
  ): Promise<T> {
    return Promise.resolve(data);
  }
}

type ProcessorTypeMap = {
  [StellarHandlerKind.Block]: typeof isBlockHandlerProcessor;
  [StellarHandlerKind.Transaction]: typeof isTransactionHandlerProcessor;
  [StellarHandlerKind.SorobanTransaction]: typeof isSorobanTransactionHandlerProcessor;
  [StellarHandlerKind.Operation]: typeof isOperationHandlerProcessor;
  [StellarHandlerKind.Effects]: typeof isEffectHandlerProcessor;
  [StellarHandlerKind.Event]: typeof isEventHandlerProcessor;
};

const ProcessorTypeMap = {
  [StellarHandlerKind.Block]: isBlockHandlerProcessor,
  [StellarHandlerKind.Transaction]: isTransactionHandlerProcessor,
  [StellarHandlerKind.SorobanTransaction]: isSorobanTransactionHandlerProcessor,
  [StellarHandlerKind.Operation]: isOperationHandlerProcessor,
  [StellarHandlerKind.Effects]: isEffectHandlerProcessor,
  [StellarHandlerKind.Event]: isEventHandlerProcessor,
};

const FilterTypeMap = {
  [StellarHandlerKind.Block]: (
    data: StellarBlock,
    filter: StellarBlockFilter,
    ds: SubqlStellarDataSource,
  ) =>
    StellarBlockWrapped.filterBlocksProcessor(
      data,
      filter,
      ds.options?.address,
    ),

  [StellarHandlerKind.Transaction]: (
    data: StellarTransaction,
    filter: StellarTransactionFilter,
    ds: SubqlStellarDataSource,
  ) =>
    StellarBlockWrapped.filterTransactionProcessor(
      data,
      filter,
      ds.options?.address,
    ),

  [StellarHandlerKind.SorobanTransaction]: (
    data: StellarTransaction,
    filter: StellarTransactionFilter,
    ds: SubqlStellarDataSource,
  ) =>
    StellarBlockWrapped.filterTransactionProcessor(
      data,
      filter,
      ds.options?.address,
    ),

  [StellarHandlerKind.Operation]: (
    data: StellarOperation,
    filter: StellarOperationFilter,
    ds: SubqlStellarDataSource,
  ) =>
    StellarBlockWrapped.filterOperationProcessor(
      data,
      filter,
      ds.options?.address,
    ),

  [StellarHandlerKind.Effects]: (
    data: StellarEffect,
    filter: StellarEffectFilter,
    ds: SubqlStellarDataSource,
  ) =>
    StellarBlockWrapped.filterEffectProcessor(
      data,
      filter,
      ds.options?.address,
    ),

  [StellarHandlerKind.Event]: (
    data: SorobanEvent,
    filter: SorobanEventFilter,
    ds: SubqlStellarDataSource,
  ) =>
    StellarBlockWrapped.filterEventProcessor(data, filter, ds.options?.address),
};
