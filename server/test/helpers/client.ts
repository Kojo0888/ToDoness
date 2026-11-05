import type { Hono } from 'hono';

/** A response whose body can be read as any shape (tests check the details). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TestResponse = Omit<Response, 'json'> & { json(): Promise<any> };

/** A tiny HTTP client for `app.request` that remembers cookies, like a browser. */
export class TestClient {
  cookies = new Map<string, string>();
  constructor(
    private readonly app: Hono<any>, // eslint-disable-line @typescript-eslint/no-explicit-any
    private readonly ip?: string,
  ) {}

  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse> {
    const h: Record<string, string> = { ...headers };
    if (this.cookies.size) h.cookie = this.cookieHeader;
    if (this.ip) h['x-forwarded-for'] = this.ip;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await this.app.request(path, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name!);
      else this.cookies.set(name!, value);
    }
    return res as TestResponse;
  }

  get = (path: string) => this.request('GET', path);
  post = (path: string, body?: unknown) => this.request('POST', path, body ?? {});
  delete = (path: string) => this.request('DELETE', path);
}
