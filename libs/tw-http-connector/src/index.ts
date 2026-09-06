export { HttpConnectionModule } from './http-connection.module';
export { HttpConnectionService } from './http-connection.service';
export {
  RequestScopedHttpConnectionService,
  RequestScopedHttpConnectionService as RSHttpConnectionService,
} from './request-scoped-http-connection.service';
export { BASE_HTTP_CONNECTOR, HC_LOGGER, DEFAULT_FORWARD_HEADERS } from './constants';
export { HttpConnectionOptions } from './types';

export type { ConnectOptions, HttpResponse, IHttpConnectionOptions, Method } from './types';
