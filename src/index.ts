import express from 'express'
import { WebEvent, configureExpress, GET, PUT, POST, DELETE, HTTP } from "./web/express-di";

export const lib = {
  express
}

export {
  WebEvent,
  configureExpress,
  GET,
  PUT,
  POST,
  DELETE,
  HTTP
}