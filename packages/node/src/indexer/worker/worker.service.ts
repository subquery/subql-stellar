// Copyright 2020-2025 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import { threadId } from 'node:worker_threads';
import { Inject, Injectable } from '@nestjs/common';
import { SubqlStellarDataSource } from '@subql/common-stellar';
import {
  NodeConfig,
  getLogger,
  IProjectService,
  ProcessBlockResponse,
  ApiService,
  BaseWorkerService,
  IProjectUpgradeService,
  IBlock,
  Header,
} from '@subql/node-core';
import { StellarBlockWrapper, SubqlDatasource } from '@subql/types-stellar';
import { stellarBlockToHeader } from '../../stellar/utils.stellar';
import { IndexerManager } from '../indexer.manager';
import { getBlockSize } from '../types';

export type FetchBlockResponse = Header;

export type WorkerStatusResponse = {
  threadId: number;
  isIndexing: boolean;
  fetchedBlocks: number;
  toFetchBlocks: number;
};

const logger = getLogger(`Worker Service #${threadId}`);

@Injectable()
export class WorkerService extends BaseWorkerService<
  StellarBlockWrapper,
  FetchBlockResponse,
  SubqlStellarDataSource,
  {}
> {
  constructor(
    @Inject('APIService') private apiService: ApiService,
    private indexerManager: IndexerManager,
    @Inject('IProjectService')
    projectService: IProjectService<SubqlDatasource>,
    @Inject('IProjectUpgradeService')
    projectUpgradeService: IProjectUpgradeService,
    nodeConfig: NodeConfig,
  ) {
    super(projectService, projectUpgradeService, nodeConfig);
  }
  protected async fetchChainBlock(
    heights: number,
    extra: {},
  ): Promise<IBlock<StellarBlockWrapper>> {
    const [block] = await this.apiService.fetchBlocks([heights]);
    return block;
  }

  protected toBlockResponse(block: StellarBlockWrapper): Header {
    return stellarBlockToHeader(block.block);
  }

  protected async processFetchedBlock(
    block: IBlock<StellarBlockWrapper>,
    dataSources: SubqlStellarDataSource[],
  ): Promise<ProcessBlockResponse> {
    return this.indexerManager.indexBlock(block, dataSources);
  }

  protected getBlockSize(block: IBlock<StellarBlockWrapper>): number {
    return getBlockSize(block.block);
  }
}
