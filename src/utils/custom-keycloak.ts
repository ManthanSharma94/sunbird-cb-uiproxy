import * as express from 'express'
import expressSession from 'express-session'
import keycloakConnect from 'keycloak-connect'
import { getKeycloakConfig } from '../configs/keycloak.config'
import { CONSTANTS } from './env'
import { logError, logInfo } from './logger'
import { PERMISSION_HELPER } from './permissionHelper'
const async = require('async')

const composable = require('composable-middleware')

export class CustomKeycloak {
  private multiTenantKeycloak = new Map<string, keycloakConnect>()

  constructor(sessionConfig: expressSession.SessionOptions) {
    // tslint:disable-next-line: no-console
    console.log('custom-keycloak::constructor start ')
    // tslint:disable-next-line: no-console
    console.log('CONSTANTS.MULTI_TENANT_KEYCLOAK -- ', CONSTANTS.MULTI_TENANT_KEYCLOAK)
    if (CONSTANTS.MULTI_TENANT_KEYCLOAK) {
      CONSTANTS.MULTI_TENANT_KEYCLOAK.split(';').forEach((v: string) => {
        const domainUrlMap = v.split(',')
        this.multiTenantKeycloak.set(
          domainUrlMap[0],
          this.generateKeyCloak(sessionConfig, domainUrlMap[1], domainUrlMap[2])
        )
      })
    }
    this.multiTenantKeycloak.set('common', this.generateKeyCloak(sessionConfig))
    // tslint:disable-next-line: no-console
    console.log('custom-keycloak::constructor end ')
  }

  middleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const keycloak = this.getKeyCloakObject(req)
    const middleware = composable(
      keycloak.middleware({
        admin: '/callback',
        logout: '/reset',
      })
    )
    middleware(req, res, next)
  }

  getKeyCloakObject(req: express.Request): keycloakConnect {
    // tslint:disable-next-line: no-console
    console.log('custom-keycloak::getKeyCloakObject')
    // tslint:disable-next-line: no-console
    console.log(`req.header('rootOrg') -- `, req.headers &&  req.header('rootOrg'))
    // tslint:disable-next-line: no-console
    console.log(`req.cookies.rootorg -- `, req.cookies && req.cookies.rootorg)
    const rootOrg =
      (req.headers ? req.header('rootOrg') : '') || (req.cookies ? req.cookies.rootorg : '')
    let domain = ''
    if (rootOrg) {
      this.multiTenantKeycloak.forEach((_value, key) => {
        if (key.toLowerCase().includes(rootOrg.toLowerCase())) {
          domain = key
        }
      })
    }
    // tslint:disable-next-line: no-console
    console.log(`custom-keycloak::getKeyCloakObject before retun value -- `, this.multiTenantKeycloak.get(req.hostname) ||
    this.multiTenantKeycloak.get(domain) ||
    this.multiTenantKeycloak.get('common'))

    return (this.multiTenantKeycloak.get(req.hostname) ||
      this.multiTenantKeycloak.get(domain) ||
      this.multiTenantKeycloak.get('common')) as keycloakConnect
  }

  // tslint:disable-next-line: no-any
  authenticated = async (request: any) => {
    // tslint:disable-next-line: no-console
    console.log('Step 3: authenticated function')
    try {
      const userId = request.kauth.grant.access_token.content.sub.split(':')
      request.session.userId = userId[userId.length - 1]
      // tslint:disable-next-line: no-console
      console.log('userId ::', userId)
      // tslint:disable-next-line: no-console
      console.log('request.session after adding userId ::', request.session)
    } catch (err) {
      logError('userId conversation error' + request.kauth.grant.access_token.content.sub)
    }
    const postLoginRequest = []
    // tslint:disable-next-line: no-any
    postLoginRequest.push((callback: any) => {
      // console.log('in pus')
      PERMISSION_HELPER.getCurrentUserRoles(request, callback)
    })

    // tslint:disable-next-line: no-any
    try {
      // tslint:disable-next-line: no-any
      const results = await async.series(postLoginRequest, (err: any) =>  {
        if (err) {
          logError('error loggin in user')
          // tslint:disable-next-line: no-console
          console.log('ERROR loggin in user ---- ', err)
        } else {
          logInfo(`${process.pid}: User authenticated`)
        }
      })
      // tslint:disable-next-line: no-console
      console.log('async.series::results ---- ', results)
    } catch (err) {
      // tslint:disable-next-line: no-console
      console.log('ERROR in aync series ---- ', err)
    }
  }

  // tslint:disable-next-line: no-any
  deauthenticated = (request: any) => {
    // console.log('De')
    delete request.session.userRoles
    delete request.session.userId
    logInfo(`${process.pid}: User Deauthenticated`)
  }

  protect = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    // tslint:disable-next-line: no-console
    console.log('custom-keycloak::protect start')
    const keycloak = this.getKeyCloakObject(req)
    keycloak.protect()(req, res, next)
    // tslint:disable-next-line: no-console
    console.log('custom-keycloak::protect end')
  }

  private generateKeyCloak(
    sessionConfig: expressSession.SessionOptions,
    url?: string,
    realm?: string
  ): keycloakConnect {
    const keycloak = new keycloakConnect(
      { store: sessionConfig.store },
      getKeycloakConfig(url, realm)
    )
    keycloak.authenticated = this.authenticated
    keycloak.deauthenticated = this.deauthenticated
    return keycloak
  }
}
