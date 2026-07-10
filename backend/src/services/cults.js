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
    throw new Error(`Cults API ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getProfile(username, apiKey) {
  const data = await gql(username, apiKey, `
    query {
      myself {
        nick
        url
        thumbnailUrl
        accountType
        followersCount
        likesCount
        viewsCount
      }
    }
  `);
  return data.myself;
}

export async function getLibrary(username, apiKey, { limit = 24, offset = 0 } = {}) {
  const data = await gql(username, apiKey, `
    query($limit: Int!, $offset: Int!) {
      myself {
        ordersCount
        orders(limit: $limit, offset: $offset) {
          creation {
            slug
            name
            thumbnailUrl
            illustrationsImageUrls
            creator { nick url }
            category { slug name }
            publishedAt
            license
          }
        }
      }
    }
  `, { limit, offset });
  return data.myself;
}

export async function getCreation(slug, username, apiKey) {
  const data = await gql(username, apiKey, `
    query($slug: String!) {
      creation(slug: $slug) {
        slug
        name
        url
        thumbnailUrl
        illustrationsImageUrls
        description
        license
        publishedAt
        likesCount
        viewsCount
        creator { nick url thumbnailUrl }
        category { slug name }
      }
    }
  `, { slug });
  return data.creation;
}

export async function searchCreations(query, username, apiKey, { limit = 24, offset = 0 } = {}) {
  const data = await gql(username, apiKey, `
    query($query: String!, $limit: Int!, $offset: Int!) {
      creationsSearchBatch(query: $query, limit: $limit, offset: $offset) {
        slug
        name
        thumbnailUrl
        creator { nick }
        category { slug name }
        publishedAt
      }
    }
  `, { query, limit, offset });
  return data.creationsSearchBatch ?? [];
}
