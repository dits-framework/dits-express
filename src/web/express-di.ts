
import { Express, Request, Response, IRouterMatcher } from 'express'
import { json as JsonParser, urlencoded as FormParser } from 'body-parser'


import { security, Security, DI } from '@dits/dits'
import { HandlerDeclaration, HandlerRegistry, Metadata, service, Handler, Container, DispatchEvent, DispatchPredicate } from '@dits/dits/lib/di/di'

const { UserPrincipal } = Security


export const EXPRESS_KEY = Symbol('dits:express')
export class WebEvent extends DispatchEvent {

  response = {
    manuallyHandled: false,
    status: 200
  }

  constructor(
    public path: string,
    public body: any,
    public method: string,
    public req: Request,
    public res: Response,
    public params: any,
    public headers: any // TODO type
  ) {
    super(EXPRESS_KEY)
  }
}

export type HttpMethod = 'GET' | 'PUT' | 'POST' | 'DELETE'


export const configureExpress = async (app: Express) => {
  const zc: Container | undefined = service.container
  // const zc: Container | undefined = zones.get('container')
  if (!zc) {
    throw new Error('Could not initialize express: no zone container found; are you sure you are running inside `initApp` handler?')
  }

  const registry: HandlerRegistry | undefined = zc.get(HandlerRegistry)
  if (!registry) {
    throw new Error('Could not initialize press: no zone handler registry found; are you sure you are running inside `initApp` handler?')
  }

  // middleware needs to go first, if you want our routes to be affected
  app.use(JsonParser())
  app.use(FormParser())

  // console.log('looking for events', WebEvent, registry)
  registry.getDeclarations(WebEvent).map(h => {
    const { path, methods } = h.metadata[HTTP_META_KEY] as HttpConfig
    methods.map(method => {
      const fn = ((app as any)[method.toLowerCase()] as IRouterMatcher<unknown>).bind(app)
      fn(path, requestDelegateHandler(path, method, h))
    })
  })
  return app
}

let reqIdx = 1
export const requestDelegateHandler = (path: string, method: HttpMethod, h: HandlerDeclaration<WebEvent>) => {
  if (!service.zone) {
    throw new Error(`Cannot create request delegate for path ${path} until root "app" zone is configured`)
  }
  return async (req: Request, res: Response) => {
    const e = new WebEvent(
      req.path,
      req.body || {},
      method,
      req,
      res,
      req.params,
      req.headers
    )

    try {
      const parent: Container = service.zone?.get('container')
      const container = new Container(parent)
      const principal = await service.context?.authenticate(e)
      const zone = service.zone!.fork({
        name: `web-${reqIdx++}`,
        properties: {
          rootEvent: e,
          container,
          principal
        }
      })
      await zone.run(async () => {
        try {
          const result = await h.handler(e)

          // if the handler got it covered, bounce
          if (e.response.manuallyHandled) {
            return
          }
          if (result) {
            res.status(e.response.status).json(result)
          } else {
            res.send(e.response.status)
          }
        } catch (err: any) {
          console.warn('Failed to invoke handler', h, err)
          res.status(500).json({ error: err.message || err })
        }
      })
    } catch (err: any) {
      console.warn('Failure at zone level', h, err)
      res.status(500).json({ error: err.message || err })
    }
  }
}

type HttpConfig = { path: string, methods: HttpMethod[] }
export const HTTP_META_KEY = Symbol("resolver");
export function HTTP(path: string, methods: HttpMethod[], ...predicates: DispatchPredicate<WebEvent>[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    Metadata(HTTP_META_KEY, { path, methods })(target, propertyKey)
    Handler(...predicates)(target, propertyKey, descriptor)
  }
}

export const GET = (path: string, ...predicates: DispatchPredicate<WebEvent>[]) => HTTP(path, ['GET'], ...predicates)
export const PUT = (path: string, ...predicates: DispatchPredicate<WebEvent>[]) => HTTP(path, ['PUT'], ...predicates)
export const POST = (path: string, ...predicates: DispatchPredicate<WebEvent>[]) => HTTP(path, ['POST'], ...predicates)
export const DELETE = (path: string, ...predicates: DispatchPredicate<WebEvent>[]) => HTTP(path, ['DELETE'], ...predicates)