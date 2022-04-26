/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { CoreStart, HttpFetchError, HttpFetchQuery } from 'kibana/public';
import { getRoutePaths } from '../common';

export interface Services {
  fetchTopN: (
    index: string,
    projectID: number,
    type: string,
    seconds: string
  ) => Promise<any[] | HttpFetchError>;
  fetchElasticFlamechart: (
    index: string,
    projectID: number,
    timeFrom: number,
    timeTo: number
  ) => Promise<any[] | HttpFetchError>;
  fetchPixiFlamechart: (
    index: string,
    projectID: number,
    timeFrom: number,
    timeTo: number
  ) => Promise<any[] | HttpFetchError>;
}

export function getServices(core: CoreStart): Services {
  const paths = getRoutePaths();

  return {
    fetchTopN: async (index: string, projectID: number, type: string, seconds: string) => {
      try {
        const unixTime = Math.floor(Date.now() / 1000);
        const query: HttpFetchQuery = {
          index,
          projectID,
          timeFrom: unixTime - parseInt(seconds, 10),
          timeTo: unixTime,
          // TODO remove hard-coded value for topN items length and expose it through the UI
          n: 100,
        };
        return await core.http.get(`${paths.TopN}/${type}`, { query });
      } catch (e) {
        return e;
      }
    },

    fetchElasticFlamechart: async (
      index: string,
      projectID: number,
      timeFrom: number,
      timeTo: number
    ) => {
      try {
        const query: HttpFetchQuery = {
          index,
          projectID,
          timeFrom,
          timeTo,
          // TODO remove hard-coded value for topN items length and expose it through the UI
          n: 100,
        };
        return await core.http.get(paths.FlamechartElastic, { query });
      } catch (e) {
        return e;
      }
    },

    fetchPixiFlamechart: async (
      index: string,
      projectID: number,
      timeFrom: number,
      timeTo: number
    ) => {
      try {
        const query: HttpFetchQuery = {
          index,
          projectID,
          timeFrom,
          timeTo,
          // TODO remove hard-coded value for topN items length and expose it through the UI
          n: 100,
        };
        return await core.http.get(paths.FlamechartPixi, { query });
      } catch (e) {
        return e;
      }
    },
  };
}
