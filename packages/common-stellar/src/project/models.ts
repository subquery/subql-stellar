// Copyright 2020-2023 SubQuery Pte Ltd authors & contributors
// SPDX-License-Identifier: GPL-3.0

import {forbidNonWhitelisted} from '@subql/common';
import {
  StellarHandlerKind,
  StellarDatasourceKind,
  SorobanEventFilter,
  SubqlCustomHandler,
  SubqlMapping,
  SubqlHandler,
  SubqlRuntimeHandler,
  SubqlRuntimeDatasource,
  SubqlCustomDatasource,
  FileReference,
  CustomDataSourceAsset,
  StellarBlockFilter,
  StellarTransactionFilter,
  StellarOperationFilter,
  StellarEffectFilter,
  SubqlBlockHandler,
  SubqlTransactionHandler,
  SubqlOperationHandler,
  SubqlEffectHandler,
  SubqlEventHandler,
} from '@subql/types-stellar';
import {plainToClass, Transform, Type} from 'class-transformer';
import {IsArray, IsEnum, IsInt, IsOptional, IsString, IsObject, ValidateNested} from 'class-validator';
import {Horizon} from 'stellar-sdk';
import {SubqlStellarProcessorOptions} from './types';

export class BlockFilter implements StellarBlockFilter {
  @IsOptional()
  @IsInt()
  modulo?: number;
  @IsOptional()
  @IsString()
  timestamp?: string;
}

export class TransactionFilter implements StellarTransactionFilter {
  @IsOptional()
  @IsString()
  account?: string;
}

export class OperationFilter implements StellarOperationFilter {
  @IsOptional()
  type: Horizon.OperationResponseType;

  @IsOptional()
  @IsString()
  source_account?: string;
}

export class EffectFilter implements StellarEffectFilter {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  account?: string;
}

export class BlockHandler implements SubqlBlockHandler {
  @IsObject()
  @IsOptional()
  @Type(() => BlockFilter)
  filter?: BlockFilter;
  @IsEnum(StellarHandlerKind, {groups: [StellarHandlerKind.Block]})
  kind: StellarHandlerKind.Block;
  @IsString()
  handler: string;
}

export class TransactionHandler implements SubqlTransactionHandler {
  @IsObject()
  @IsOptional()
  @Type(() => TransactionFilter)
  filter?: TransactionFilter;
  @IsEnum(StellarHandlerKind, {groups: [StellarHandlerKind.Transaction]})
  kind: StellarHandlerKind.Transaction;
  @IsString()
  handler: string;
}

export class OperationHandler implements SubqlOperationHandler {
  @IsObject()
  @IsOptional()
  @Type(() => OperationFilter)
  filter?: OperationFilter;
  @IsEnum(StellarHandlerKind, {groups: [StellarHandlerKind.Operation]})
  kind: StellarHandlerKind.Operation;
  @IsString()
  handler: string;
}

export class EffectHandler implements SubqlEffectHandler {
  @IsObject()
  @IsOptional()
  @Type(() => EffectFilter)
  filter?: EffectFilter;
  @IsEnum(StellarHandlerKind, {groups: [StellarHandlerKind.Effects]})
  kind: StellarHandlerKind.Effects;
  @IsString()
  handler: string;
}

export class EventFilter implements SorobanEventFilter {
  @IsOptional()
  @IsString()
  contractId?: string;
  @IsOptional()
  @IsArray()
  topics?: string[];
}

export class EventHandler implements SubqlEventHandler {
  @forbidNonWhitelisted({topics: '', contractId: ''})
  @IsOptional()
  @ValidateNested()
  @Type(() => EventFilter)
  filter?: SorobanEventFilter;
  @IsEnum(StellarHandlerKind, {groups: [StellarHandlerKind.Event]})
  kind: StellarHandlerKind.Event;
  @IsString()
  handler: string;
}

export class CustomHandler implements SubqlCustomHandler {
  @IsString()
  kind: string;
  @IsString()
  handler: string;
  @IsObject()
  @IsOptional()
  filter?: Record<string, unknown>;
}

export class StellarMapping implements SubqlMapping {
  @Transform((params) => {
    const handlers: SubqlHandler[] = params.value;
    return handlers.map((handler) => {
      switch (handler.kind) {
        case StellarHandlerKind.Block:
          return plainToClass(BlockHandler, handler);
        case StellarHandlerKind.Transaction:
          return plainToClass(TransactionHandler, handler);
        case StellarHandlerKind.Operation:
          return plainToClass(OperationHandler, handler);
        case StellarHandlerKind.Effects:
          return plainToClass(EffectHandler, handler);
        case StellarHandlerKind.Event:
          return plainToClass(EventHandler, handler);
        default:
          throw new Error(`handler ${(handler as any).kind} not supported`);
      }
    });
  })
  @IsArray()
  @ValidateNested()
  handlers: SubqlHandler[];
  @IsString()
  file: string;
}

export class CustomMapping implements SubqlMapping<SubqlCustomHandler> {
  @IsArray()
  @Type(() => CustomHandler)
  @ValidateNested()
  handlers: CustomHandler[];
  @IsString()
  file: string;
}

export class StellarProcessorOptions implements SubqlStellarProcessorOptions {
  @IsOptional()
  @IsString()
  abi?: string;
  @IsOptional()
  @IsString()
  address?: string;
}

export class RuntimeDataSourceBase<M extends SubqlMapping<SubqlRuntimeHandler>> implements SubqlRuntimeDatasource<M> {
  @IsEnum(StellarDatasourceKind, {
    groups: [StellarDatasourceKind.Runtime],
  })
  kind: StellarDatasourceKind.Runtime;
  @Type(() => StellarMapping)
  @ValidateNested()
  mapping: M;
  @IsOptional()
  @IsInt()
  startBlock?: number;
  @IsOptional()
  assets?: Map<string, FileReference>;
  @IsOptional()
  @ValidateNested()
  @Type(() => StellarProcessorOptions)
  options?: StellarProcessorOptions;
}

export class FileReferenceImpl implements FileReference {
  @IsString()
  file: string;
}

export class CustomDataSourceBase<K extends string, M extends SubqlMapping = SubqlMapping<SubqlCustomHandler>>
  implements SubqlCustomDatasource<K, M>
{
  @IsString()
  kind: K;
  @Type(() => CustomMapping)
  @ValidateNested()
  mapping: M;
  @IsOptional()
  @IsInt()
  startBlock?: number;
  @Type(() => FileReferenceImpl)
  @ValidateNested({each: true})
  assets: Map<string, CustomDataSourceAsset>;
  @Type(() => FileReferenceImpl)
  @IsObject()
  processor: FileReference;
  @IsOptional()
  @ValidateNested()
  options?: StellarProcessorOptions;
}