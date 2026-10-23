// Serves the site: the page from the assets binding, the API from the origin.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return fetch(`${env.ORIGIN}${url.pathname}`);
    }
    return env.ASSETS.fetch(request);
  },
};
