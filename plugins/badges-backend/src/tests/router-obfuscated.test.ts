/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import express from 'express';
import request from 'supertest';
import {
  getVoidLogger,
  PluginEndpointDiscovery,
  ServerTokenManager,
  SingleHostDiscovery,
} from '@backstage/backend-common';
import { CatalogApi } from '@backstage/catalog-client';
import type { Entity } from '@backstage/catalog-model';
import { Config, ConfigReader } from '@backstage/config';
import { createRouter } from '../service/router';
import { BadgeBuilder } from '../lib';
import {
  BackstageIdentityResponse,
  IdentityApiGetIdentityRequest,
} from '@backstage/plugin-auth-node';

describe('createRouter', () => {
  let app: express.Express;
  let badgeBuilder: jest.Mocked<BadgeBuilder>;

  const catalog = {
    addLocation: jest.fn(),
    getEntities: jest.fn(),
    getEntityByRef: jest.fn(),
    getLocationByRef: jest.fn(),
    getLocationById: jest.fn(),
    removeLocationById: jest.fn(),
    removeEntityByUid: jest.fn(),
    refreshEntity: jest.fn(),
    getEntityAncestors: jest.fn(),
    getEntityFacets: jest.fn(),
    validateEntity: jest.fn(),
  };
  let config: Config;
  let discovery: PluginEndpointDiscovery;

  const getIdentity = jest.fn();

  const entity: Entity = {
    apiVersion: 'v1',
    kind: 'Component',
    metadata: {
      name: 'test',
    },
  };

  const entities: Entity[] = [
    entity,
    {
      apiVersion: 'v1',
      kind: 'Component',
      metadata: {
        name: 'test-2',
      },
    },
  ];

  const badge = {
    id: 'test-badge',
    badge: {
      label: 'test',
      message: 'badge',
    },
    url: '/...',
    markdown: '[![...](...)]',
  };

  beforeAll(async () => {
    getIdentity.mockImplementation(
      async ({
        request: _request,
      }: IdentityApiGetIdentityRequest): Promise<
        BackstageIdentityResponse | undefined
      > => {
        return {
          identity: {
            userEntityRef: 'user:default/guest',
            ownershipEntityRefs: [],
            type: 'user',
          },
          token: 'token',
        };
      },
    );

    badgeBuilder = {
      getBadges: jest.fn(),
      createBadgeJson: jest.fn(),
      createBadgeSvg: jest.fn(),
    };
    config = new ConfigReader({
      backend: {
        baseUrl: 'http://127.0.0.1',
        listen: {
          port: 7007,
        },
      },
      app: {
        badges: {
          obfuscate: true,
        },
      },
      custom: {
        'badges-backend': {
          salt: 'random-string',
          cacheTimeToLive: '60',
        },
      },
    });

    discovery = SingleHostDiscovery.fromConfig(config);
    const tokenManager = ServerTokenManager.noop();
    const router = await createRouter({
      badgeBuilder,
      catalog: catalog as Partial<CatalogApi> as CatalogApi,
      config,
      discovery,
      tokenManager,
      logger: getVoidLogger(),
      identity: { getIdentity },
    });
    app = express().use(router);
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('works', async () => {
    const tokenManager = ServerTokenManager.noop();
    const router = await createRouter({
      badgeBuilder,
      catalog: catalog as Partial<CatalogApi> as CatalogApi,
      config,
      discovery,
      tokenManager,
      logger: getVoidLogger(),
      identity: { getIdentity },
    });
    expect(router).toBeDefined();
  });

  describe('GET /entity/:namespace/:kind/:name/badge-specs', () => {
    it('does not returns all badge specs for entity', async () => {
      catalog.getEntityByRef.mockResolvedValueOnce(entity);

      badgeBuilder.getBadges.mockResolvedValueOnce([{ id: badge.id }]);
      badgeBuilder.createBadgeJson.mockResolvedValueOnce(badge);

      const response = await request(app).get(
        '/entity/default/component/test/badge-specs',
      );

      expect(response.status).toEqual(404);
    });
  });

  describe('GET /entity/:namespace/:kind/:name/badge/test-badge', () => {
    it('does not returns badge for entity', async () => {
      catalog.getEntityByRef.mockResolvedValueOnce(entity);

      const image = '<svg>...</svg>';
      badgeBuilder.createBadgeSvg.mockResolvedValueOnce(image);

      const response = await request(app).get(
        '/entity/default/component/test/badge/test-badge',
      );

      expect(response.status).toEqual(404);
    });

    it('does not returns badge spec for entity', async () => {
      catalog.getEntityByRef.mockResolvedValueOnce(entity);
      badgeBuilder.createBadgeJson.mockResolvedValueOnce(badge);

      const url = '/entity/default/component/test/badge/test-badge?format=json';
      const response = await request(app).get(url);

      expect(response.status).toEqual(404);
    });
  });

  describe('GET /entity/:entityHash/badge-specs', () => {
    it('returns all badge specs for entity', async () => {
      catalog.getEntities.mockResolvedValueOnce({ items: entities });
      catalog.getEntityByRef.mockResolvedValueOnce(entity);

      badgeBuilder.getBadges.mockResolvedValueOnce([{ id: badge.id }]);
      badgeBuilder.createBadgeJson.mockResolvedValueOnce(badge);

      const response = await request(app).get(
        '/entity/3a5f91c1e66519be5394c37a8ba69c3087b7c322c600e7497dc9d517353e5bed/badge-specs',
      );
      expect(response.status).toEqual(200);
      expect(response.body).toEqual([badge]);

      expect(catalog.getEntityByRef).toHaveBeenCalledTimes(1);
      expect(catalog.getEntityByRef).toHaveBeenCalledWith(
        {
          namespace: 'default',
          kind: 'component',
          name: 'test',
        },
        { token: '' },
      );

      expect(badgeBuilder.getBadges).toHaveBeenCalledTimes(1);
      expect(badgeBuilder.createBadgeJson).toHaveBeenCalledTimes(1);
      expect(badgeBuilder.createBadgeJson).toHaveBeenCalledWith({
        badgeInfo: { id: badge.id },
        context: {
          badgeUrl: expect.stringMatching(
            /http:\/\/127.0.0.1\/api\/badges\/entity\/3a5f91c1e66519be5394c37a8ba69c3087b7c322c600e7497dc9d517353e5bed\/test-badge/,
          ),
          config,
          entity,
        },
      });
    });
  });

  describe('GET /entity/:entityHash/test-badge', () => {
    it('returns badge for entity', async () => {
      catalog.getEntityByRef.mockResolvedValueOnce(entity);
      catalog.getEntities.mockResolvedValueOnce({ items: entities });

      const image = '<svg>...</svg>';
      badgeBuilder.createBadgeSvg.mockResolvedValueOnce(image);

      const response = await request(app).get(
        '/entity/3a5f91c1e66519be5394c37a8ba69c3087b7c322c600e7497dc9d517353e5bed/test-badge',
      );

      expect(response.status).toEqual(200);
      expect(response.body).toEqual(Buffer.from(image));

      expect(catalog.getEntityByRef).toHaveBeenCalledTimes(1);
      expect(catalog.getEntityByRef).toHaveBeenCalledWith(
        {
          namespace: 'default',
          kind: 'component',
          name: 'test',
        },
        { token: '' },
      );

      expect(badgeBuilder.getBadges).toHaveBeenCalledTimes(0);
      expect(badgeBuilder.createBadgeSvg).toHaveBeenCalledTimes(1);
      expect(badgeBuilder.createBadgeSvg).toHaveBeenCalledWith({
        badgeInfo: { id: badge.id },
        context: {
          badgeUrl: expect.stringMatching(
            /http:\/\/127.0.0.1\/api\/badges\/entity\/3a5f91c1e66519be5394c37a8ba69c3087b7c322c600e7497dc9d517353e5bed\/test-badge/,
          ),
          config,
          entity,
        },
      });
    });

    it('returns badge spec for entity', async () => {
      catalog.getEntityByRef.mockResolvedValueOnce(entity);
      catalog.getEntities.mockResolvedValueOnce({ items: entities });
      badgeBuilder.createBadgeJson.mockResolvedValueOnce(badge);

      const url =
        '/entity/3a5f91c1e66519be5394c37a8ba69c3087b7c322c600e7497dc9d517353e5bed/test-badge?format=json';
      const response = await request(app).get(url);

      expect(response.status).toEqual(200);
      expect(response.body).toEqual(badge);
    });
  });

  describe('GET /entity/:namespace/:kind/:name/obfuscated', () => {
    catalog.getEntityByRef.mockResolvedValueOnce(entity);
    catalog.getEntities.mockResolvedValueOnce({ items: entities });

    it('returns obfuscated entity', async () => {
      const obfuscatedEntity = await request(app)
        .get('/entity/default/component/test/obfuscated')
        .set('Authorization', 'Bearer fakeToken');
      expect(obfuscatedEntity.status).toEqual(200);
      // echo -n  "component:default:test:random-string" | openssl dgst -sha256
      expect(obfuscatedEntity.body).toEqual({
        hash: '3a5f91c1e66519be5394c37a8ba69c3087b7c322c600e7497dc9d517353e5bed',
      });
    });

    it('returns obfuscated 401 if no auth', async () => {
      const obfuscatedEntity = await request(app).get(
        '/entity/default/component/test/obfuscated',
      );
      expect(obfuscatedEntity.status).toEqual(401);
    });
  });

  describe('Errors', () => {
    it('returns 404 for unknown entity hash', async () => {
      catalog.getEntityByRef.mockResolvedValueOnce(entity);
      catalog.getEntities.mockResolvedValueOnce({ items: entities });
      badgeBuilder.getBadges.mockResolvedValueOnce([{ id: badge.id }]);
      badgeBuilder.createBadgeJson.mockResolvedValueOnce(badge);

      async function testUrl(url: string) {
        const response = await request(app).get(url);
        expect(response.status).toEqual(404);
        expect(response.body).toEqual({
          error: {
            message: expect.any(String),
            name: 'NotFoundError',
          },
          request: {
            method: 'GET',
            url,
          },
          response: {
            statusCode: 404,
          },
        });
      }
      await testUrl(
        '/entity/3a5f91c1e66519be5394c37a8ba69cfsf3087b7c322c600e7497dc9d517353e5bed/badge-specs',
      );
      await testUrl(
        '/entity/3a5f91c1e66519be5394c37a8ba69c3087b7csfsf322c600e7497dc9d517353e5bed/test-badge',
      );
    });
  });
});