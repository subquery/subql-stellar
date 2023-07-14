// Copyright 2020-2022 OnFinality Limited authors & contributors
// SPDX-License-Identifier: Apache-2.0

import fs from 'fs';
import http from 'http';
import https from 'https';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { getLogger, timeout } from '@subql/node-core';
import {
  ApiWrapper,
  SorobanBlock,
  SorobanBlockWrapper,
  SorobanEvent,
  SubqlRuntimeDatasource,
} from '@subql/types-soroban';
import CacheableLookup from 'cacheable-lookup';
import { Server, SorobanRpc } from 'soroban-client';
import { retryOnFailEth } from '../utils/project';
import { yargsOptions } from '../yargs';
import { SorobanBlockWrapped } from './block.soroban';
import SafeSorobanProvider from './safe-api';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version: packageVersion } = require('../../package.json');

const logger = getLogger('api.Soroban');

async function loadAssets(
  ds: SubqlRuntimeDatasource,
): Promise<Record<string, string>> {
  if (!ds.assets) {
    return {};
  }
  const res: Record<string, string> = {};

  for (const [name, { file }] of Object.entries(ds.assets)) {
    try {
      res[name] = await fs.promises.readFile(file, { encoding: 'utf8' });
    } catch (e) {
      throw new Error(`Failed to load datasource asset ${file}`);
    }
  }

  return res;
}

function getHttpAgents() {
  // By default Nodejs doesn't cache DNS lookups
  // https://httptoolkit.com/blog/configuring-nodejs-dns/
  const lookup = new CacheableLookup();

  const options: http.AgentOptions = {
    keepAlive: true,
    /*, maxSockets: 100*/
  };

  const httpAgent = new http.Agent(options);
  const httpsAgent = new https.Agent(options);

  lookup.install(httpAgent);
  lookup.install(httpsAgent);

  return {
    http: httpAgent,
    https: httpsAgent,
  };
}

export class SorobanApi implements ApiWrapper<SorobanBlockWrapper> {
  private client: Server;

  // This is used within the sandbox when HTTP is used
  //private nonBatchClient?: JsonRpcProvider;
  private genesisBlock: Record<string, any>;
  //private contractInterfaces: Record<string, Interface> = {};
  private chainId: string;
  private name: string;

  // Soroban POS
  private supportsFinalization = true;
  private blockConfirmations = yargsOptions.argv['block-confirmations'];

  constructor(private endpoint: string, private eventEmitter: EventEmitter2) {
    const { hostname, protocol, searchParams } = new URL(endpoint);

    const protocolStr = protocol.replace(':', '');

    logger.info(`Api host: ${hostname}, method: ${protocolStr}`);
    if (protocolStr === 'https' || protocolStr === 'http') {
      const options: Server.Options = {
        //headers: {
        //  'User-Agent': `Subquery-Node ${packageVersion}`,
        //},
        //allowGzip: true,
        //throttleLimit: 5,
        //throttleSlotInterval: 1,
        //agents: getHttpAgents(),
        allowHttp: protocolStr === 'http',
      };
      //searchParams.forEach((value, name, searchParams) => {
      //  (connection.headers as any)[name] = value;
      //});
      this.client = new Server(endpoint, options);
    } else if (protocolStr === 'ws' || protocolStr === 'wss') {
      this.client = new Server(this.endpoint);
    } else {
      throw new Error(`Unsupported protocol: ${protocol}`);
    }
  }

  async init(): Promise<void> {
    const network = await this.client.getNetwork();
    this.chainId = network.passphrase;
    //this.injectClient();
    /*
    const [genesisBlock, network, supportsFinalization, supportsSafe] =
      await Promise.all([
        this.client.getBlock('earliest'),
        this.client.getNetwork(),
        this.getSupportsTag('finalized'),
        this.getSupportsTag('safe'),
      ]);
    this.genesisBlock = genesisBlock;
    this.supportsFinalization = supportsFinalization && supportsSafe;
    this.chainId = network.chainId;
    this.name = network.name;
    */
  }

  async getFinalizedBlock(): Promise<SorobanRpc.GetLatestLedgerResponse> {
    return this.client.getLatestLedger();
  }

  async getFinalizedBlockHeight(): Promise<number> {
    return (await this.getFinalizedBlock()).sequence;
  }

  async getBestBlockHeight(): Promise<number> {
    return (await this.client.getLatestLedger()).sequence;
  }

  getRuntimeChain(): string {
    return this.name;
  }

  getChainId(): string {
    return this.chainId;
  }

  getGenesisHash(): string {
    return this.getChainId();
  }

  getSpecName(): string {
    return 'Soroban';
  }

  async getEvents(height: number): Promise<SorobanRpc.GetEventsResponse> {
    return this.client.getEvents({
      startLedger: height,
      filters: [],
    });
  }

  async fetchBlock(
    blockNumber: number,
    includeTx?: boolean,
  ): Promise<SorobanBlockWrapped> {
    try {
      const events = await this.getEvents(blockNumber);

      const ret = new SorobanBlockWrapped(events.events ?? [], {
        height: blockNumber,
        hash: blockNumber.toString(),
      } as SorobanBlock);

      logger.info(JSON.stringify(ret));
      this.eventEmitter.emit('fetchBlock');
      return ret;
    } catch (e) {
      throw this.handleError(e);
    }
  }

  async fetchBlocks(bufferBlocks: number[]): Promise<SorobanBlockWrapper[]> {
    return Promise.all(
      bufferBlocks.map(async (num) => this.fetchBlock(num, true)),
    );
  }

  get api(): Server {
    return this.client;
  }

  getSafeApi(blockHeight: number): SafeSorobanProvider {
    return new SafeSorobanProvider(this.client, blockHeight);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async connect(): Promise<void> {
    logger.error('Soroban API connect is not implemented');
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async disconnect(): Promise<void> {
    logger.error('Soroban API disconnect is not implemented');
    throw new Error('Not implemented');
  }

  handleError(e: Error): Error {
    if ((e as any)?.status === 429) {
      const { hostname } = new URL(this.endpoint);
      return new Error(`Rate Limited at endpoint: ${hostname}`);
    }

    return e;
  }
}
