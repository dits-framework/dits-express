import service, { ANONYMOUS, Authenticator, SecurityContext, Service } from '@dits/dits'
import { Application, Request, Response, IRouterMatcher } from 'express'
import { json as JsonParser, urlencoded as FormParser } from 'body-parser'

import { HandlerDeclaration, HandlerRegistry, Handler, Container, DispatchEvent, DispatchPredicate } from '@dits/dits'


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
    super('express')
  }
}

export type HttpMethod = 'GET' | 'PUT' | 'POST' | 'DELETE'


export const configureExpress = async (app: Application, registry: HandlerRegistry) => {
  // middleware needs to go first, if you want our routes to be affected
  app.use(JsonParser())
  app.use(FormParser({ extended: true }))

  // console.log('looking for events', WebEvent, registry)
  registry.getDeclarations(WebEvent).map(hr => {
    // const resolvers: HttpConfig[] = Reflect.getMetadata(HTTP_META_KEY, h.target.constructor) || []
    hr.metadata.http = (Reflect.getMetadata(HTTP_META_KEY, hr.target.constructor) || []) as HttpConfig[]
    hr.metadata.http.forEach(({ path, methods, handler }: HttpConfig) => {
      methods.forEach(method => {
        const fn = ((app as any)[method.toLowerCase()] as IRouterMatcher<unknown>).bind(app)
        fn(path, requestDelegateHandler(path, method, hr, hr.target[handler]))
      })
    })

    // const { path, methods } = h.metadata[HTTP_META_KEY] as HttpConfig
    // methods.map(method => {
    //   const fn = ((app as any)[method.toLowerCase()] as IRouterMatcher<unknown>).bind(app)
    //   fn(path, requestDelegateHandler(path, method, h))
    // })
  })
  return app
}

let reqIdx = 1
export const requestDelegateHandler = (path: string, method: HttpMethod, h: HandlerDeclaration<WebEvent>, handler: Function) => {
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
      // const parent: Container = service.zone?.get('container')
      // const container = new Container(parent)
      // const principal = await service.context?.authenticate(e)
      // const sc = new SecurityContext(principal)
      // container.register(SecurityContext, sc)
      // const zone = service.zone!.fork({
      //   name: `web-${reqIdx++}`,
      //   properties: {
      //     rootEvent: e,
      //     container,
      //     principal
      //   }
      // })

      const service = Service.fromZone()
      const container = Container.fromZone()
      const authenticator = container.get<Authenticator>(Authenticator)
      const principal = authenticator ? await authenticator.authenticate(e) : ANONYMOUS

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

          const child = Container.fromZone();

          // seems like this should come later, but causes issues if so
          await child.initialize('web', 'graphql')

          const sc = new SecurityContext(principal)
          child.provide(SecurityContext, sc, true)
          child.provide(WebEvent, e, true)

          const result = await handler(e)

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

type HttpConfig = { path: string, target: any, handler: string, methods: HttpMethod[] }
export const HTTP_META_KEY = Symbol("resolver");
export function HTTP(path: string, methods: HttpMethod[], ...predicates: DispatchPredicate<WebEvent>[]) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // Metadata(HTTP_META_KEY, { path, methods })(target, propertyKey)
    const resolvers: HttpConfig[] = Reflect.getMetadata(HTTP_META_KEY, target.constructor) || []
    resolvers.push({ path, target, handler: propertyKey, methods })
    Reflect.defineMetadata(HTTP_META_KEY, resolvers, target.constructor);
    Handler(WebEvent, ...predicates)(target, propertyKey, descriptor)
  }
}

export const GET = (path: string, ...predicates: DispatchPredicate<WebEvent>[]) => HTTP(path, ['GET'], ...predicates)
export const PUT = (path: string, ...predicates: DispatchPredicate<WebEvent>[]) => HTTP(path, ['PUT'], ...predicates)
export const POST = (path: string, ...predicates: DispatchPredicate<WebEvent>[]) => HTTP(path, ['POST'], ...predicates)
export const DELETE = (path: string, ...predicates: DispatchPredicate<WebEvent>[]) => HTTP(path, ['DELETE'], ...predicates)