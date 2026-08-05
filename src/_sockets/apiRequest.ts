import { registerApiMethodMap } from '@luckystack/core/client';

import { apiMethodMap } from './apiTypes.generated';

//? Register the generated route→HTTP-method map so `apiRequest` resolves the real method
//? per route. Under the socket transport this is inert; it is what keeps a future
//? 'routed-http' switch from falling back to guessing the method from the route name.
registerApiMethodMap(apiMethodMap);

export { apiRequest } from '@luckystack/core/client';
export type { ApiStreamEvent } from '@luckystack/core/client';
