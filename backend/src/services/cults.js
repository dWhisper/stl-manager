// Cults 3D GraphQL API — https://cults3d.com/en/api
// Auth: HTTP Basic (username:api_key)

const ENDPOINT = 'https://cults3d.com/graphql';

function authHeader(username, apiKey) {
  return 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64');
}

async function gql(username, apiKey, query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: authHeader(username, apiKey),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    // Pass auth failures through as 401 so they aren't reported as a 502
    const status = res.status === 401 || res.status === 403 ? 401 : undefined;
    throw Object.assign(new Error(`Cults API ${res.status}: ${text}`), { status });
  }

  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

// ── Public API ────────────────────────────────────────────────────────────────
// Fields are aliased to the names the frontend reads (thumbnailUrl, url, …).

export async function getProfile(username, apiKey) {
  const data = await gql(username, apiKey, `
    query {
      myself {
        user {
          nick
          url: shortUrl
          thumbnailUrl: imageUrl
          followersCount
          creationsCount
        }
      }
    }
  `);
  return data.myself.user;
}

export async function getLibrary(username, apiKey, { limit = 24, offset = 0 } = {}) {
  const data = await gql(username, apiKey, `
    query($limit: Int!, $offset: Int!) {
      myself {
        ordersBatch(limit: $limit, offset: $offset) {
          total
          results {
            lines {
              creation {
                slug
                name(locale: EN)
                url(locale: EN)
                thumbnailUrl: illustrationImageUrl
                creator { nick url: shortUrl }
                category { name(locale: EN) }
                publishedAt
              }
            }
          }
        }
      }
    }
  `, { limit, offset });
  const batch = data.myself.ordersBatch;
  // One order can hold several creations; flatten to one entry per creation
  const orders = (batch?.results ?? []).flatMap((o) => o.lines ?? []).map((l) => ({ creation: l.creation }));
  return { ordersCount: batch?.total ?? orders.length, orders };
}

export async function getCreation(slug, username, apiKey) {
  const data = await gql(username, apiKey, `
    query($slug: String!) {
      creation(slug: $slug) {
        slug
        name(locale: EN)
        url(locale: EN)
        thumbnailUrl: illustrationImageUrl
        illustrations { imageUrl }
        description(locale: EN)
        license { code name(locale: EN) }
        publishedAt
        likesCount
        viewsCount
        creator { nick url: shortUrl thumbnailUrl: imageUrl }
        category { name(locale: EN) }
      }
    }
  `, { slug });
  const creation = data.creation;
  if (creation) creation.illustrationsImageUrls = (creation.illustrations ?? []).map((i) => i.imageUrl);
  return creation;
}

export async function searchCreations(query, username, apiKey, { limit = 24, offset = 0 } = {}) {
  const data = await gql(username, apiKey, `
    query($query: String!, $limit: Int, $offset: Int) {
      creationsSearchBatch(query: $query, limit: $limit, offset: $offset) {
        results {
          slug
          name(locale: EN)
          url(locale: EN)
          thumbnailUrl: illustrationImageUrl
          creator { nick }
          category { name(locale: EN) }
          publishedAt
        }
      }
    }
  `, { query, limit, offset });
  return data.creationsSearchBatch?.results ?? [];
}
