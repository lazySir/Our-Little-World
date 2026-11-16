export type ApiMethod = NonNullable<UniApp.RequestOptions['method']> | 'PATCH';
type ApiRequestOptions = Omit<UniApp.RequestOptions, 'method'> & { method: ApiMethod };

export function toUniRequest(options: ApiRequestOptions): UniApp.RequestOptions {
  const { method, ...request } = options;
  return method === 'PATCH'
    ? {
        ...request,
        method: 'POST',
        header: { ...request.header, 'X-HTTP-Method-Override': 'PATCH' },
      }
    : { ...request, method };
}
