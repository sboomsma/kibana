/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */
import { schema, TypeOf } from '@kbn/config-schema';
import type { ElasticsearchClient, IRouter, Logger } from 'kibana/server';
import type { DataRequestHandlerContext } from '../../../data/server';
import { getRoutePaths } from '../../common';
import { createTopNFunctions } from '../../common/functions';
import { logExecutionLatency } from './logger';
import { createProjectTimeQuery, ProjectTimeQuery } from './query';
import { downsampleEventsRandomly, findDownsampledIndex } from './downsampling';
import {
  mgetExecutables,
  mgetStackFrames,
  mgetStackTraces,
  searchEventsGroupByStackTrace,
  searchStackTraces,
} from './stacktrace';
import { getClient } from './compat';

async function queryTopNFunctions(
  logger: Logger,
  client: ElasticsearchClient,
  index: string,
  filter: ProjectTimeQuery,
  startIndex: number,
  endIndex: number,
  sampleSize: number
): Promise<any> {
  const testing = index === 'profiling-events2';
  if (testing) {
    index = 'profiling-events-all';
  }

  const eventsIndex = await logExecutionLatency(
    logger,
    'query to find downsampled index',
    async () => {
      return await findDownsampledIndex(logger, client, index, filter, sampleSize);
    }
  );

  let { totalCount, stackTraceEvents } = await searchEventsGroupByStackTrace(
    logger,
    client,
    eventsIndex,
    filter
  );

  // Manual downsampling if totalCount exceeds sampleSize by 10%.
  if (totalCount > sampleSize * 1.1) {
    const p = sampleSize / totalCount;
    logger.info('downsampling events with p=' + p);
    await logExecutionLatency(logger, 'downsampling events', async () => {
      totalCount = downsampleEventsRandomly(stackTraceEvents, p, filter.toString());
    });
    logger.info('downsampled total count: ' + totalCount);
    logger.info('unique downsampled stacktraces: ' + stackTraceEvents.size);
  }

  // profiling-stacktraces is configured with 16 shards
  const { stackTraces, stackFrameDocIDs, executableDocIDs } = testing
    ? await searchStackTraces(logger, client, stackTraceEvents)
    : await mgetStackTraces(logger, client, stackTraceEvents);

  return Promise.all([
    mgetStackFrames(logger, client, stackFrameDocIDs),
    mgetExecutables(logger, client, executableDocIDs),
  ]).then(([stackFrames, executables]) => {
    return createTopNFunctions(
      stackTraceEvents,
      stackTraces,
      stackFrames,
      executables,
      startIndex,
      endIndex
    );
  });
}

const querySchema = schema.object({
  index: schema.string(),
  projectID: schema.number(),
  timeFrom: schema.number(),
  timeTo: schema.number(),
  startIndex: schema.number(),
  endIndex: schema.number(),
});

type QuerySchemaType = TypeOf<typeof querySchema>;

export function registerTopNFunctionsSearchRoute(
  router: IRouter<DataRequestHandlerContext>,
  logger: Logger
) {
  const paths = getRoutePaths();
  router.get(
    {
      path: paths.TopNFunctions,
      validate: {
        query: querySchema,
      },
    },
    async (context, request, response) => {
      try {
        const { index, projectID, timeFrom, timeTo, startIndex, endIndex }: QuerySchemaType =
          request.query;
        const targetSampleSize = 20000; // minimum number of samples to get statistically sound results
        const esClient = await getClient(context);
        const filter = createProjectTimeQuery(projectID, timeFrom, timeTo);

        const topNFunctions = await queryTopNFunctions(
          logger,
          esClient,
          index,
          filter,
          startIndex,
          endIndex,
          targetSampleSize
        );
        logger.info('returning payload response to client');

        return response.ok({
          body: topNFunctions,
        });
      } catch (e) {
        logger.error('Caught exception when fetching Top N functions data: ' + e.message);
        return response.customError({
          statusCode: e.statusCode ?? 500,
          body: {
            message: e.message,
          },
        });
      }
    }
  );
}
