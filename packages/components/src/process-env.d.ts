// The one Node-style global components may read: the Bun dev server and the production build inline
// `process.env.NODE_ENV` ("development" / "production"); no other Bun or Node global is visible here.
declare const process: { readonly env: { readonly NODE_ENV?: string } };
